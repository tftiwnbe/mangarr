package mangarr.tachibridge.extensions

import eu.kanade.tachiyomi.network.HttpException
import io.grpc.Status
import io.grpc.StatusException
import io.grpc.StatusRuntimeException
import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.serialization.MissingFieldException
import java.util.regex.Pattern
import mangarr.tachibridge.HealthCheckRequest
import mangarr.tachibridge.HealthCheckResponse
import mangarr.tachibridge.TachibridgeGrpcKt
import mangarr.tachibridge.config.ConfigManager
import mangarr.tachibridge.config.FlareSolverrConfig
import mangarr.tachibridge.config.GetFlareSolverrConfigRequest
import mangarr.tachibridge.config.GetFlareSolverrConfigResponse
import mangarr.tachibridge.config.SetFlareSolverrConfigRequest
import mangarr.tachibridge.config.SetFlareSolverrConfigResponse
import mangarr.tachibridge.config.SetRepoUrlRequest
import mangarr.tachibridge.config.SetRepoUrlResponse
import mangarr.tachibridge.repo.ExtensionRepoService

private val logger = KotlinLogging.logger {}

@kotlinx.serialization.ExperimentalSerializationApi
class ExtensionBridgeService(
    private val extensionManager: ExtensionManager,
    private val repoService: ExtensionRepoService,
) : TachibridgeGrpcKt.TachibridgeCoroutineImplBase() {
    private fun asGrpcException(operation: String, error: Exception): Exception {
        if (error is StatusException || error is StatusRuntimeException) return error

        val chain = generateSequence(error as Throwable?) { it.cause }.toList()
        val rootCause = chain.lastOrNull() ?: error
        val chainMessages = chain.mapNotNull { it.message?.trim() }.filter { it.isNotEmpty() }

        val directHttp = chain.filterIsInstance<HttpException>().lastOrNull()
        val messageHttpCode =
            chainMessages
                .asSequence()
                .mapNotNull { msg ->
                    Pattern.compile("HTTP error\\s+(\\d+)", Pattern.CASE_INSENSITIVE).matcher(msg).let {
                        if (it.find()) it.group(1)?.toIntOrNull() else null
                    }
                }.firstOrNull()
        val httpCode = directHttp?.code ?: messageHttpCode

        val reason =
            when {
                httpCode != null -> "HTTP error $httpCode"
                rootCause is MissingFieldException -> rootCause.message?.trim().orEmpty()
                else -> (rootCause.message?.trim().orEmpty()).ifEmpty {
                    chainMessages.lastOrNull() ?: rootCause::class.java.simpleName
                }
            }
        val status =
            when {
                httpCode != null ->
                    when (httpCode) {
                        401 -> Status.UNAUTHENTICATED
                        403 -> Status.PERMISSION_DENIED
                        404 -> Status.NOT_FOUND
                        408 -> Status.DEADLINE_EXCEEDED
                        429 -> Status.RESOURCE_EXHAUSTED
                        in 500..599 -> Status.UNAVAILABLE
                        else -> Status.FAILED_PRECONDITION
                    }
                rootCause is MissingFieldException -> Status.FAILED_PRECONDITION
                reason.contains("missingfieldexception", ignoreCase = true) ||
                    reason.contains("libgroup.pages", ignoreCase = true) -> Status.FAILED_PRECONDITION
                rootCause is IllegalArgumentException -> Status.INVALID_ARGUMENT
                rootCause is NoSuchElementException -> Status.NOT_FOUND
                else -> Status.INTERNAL
            }
        return status.withDescription("$operation failed: $reason").withCause(error).asRuntimeException()
    }

    override suspend fun setRepoUrl(request: SetRepoUrlRequest): SetRepoUrlResponse =
        try {
            ConfigManager.setRepoUrl(request.url)
            repoService.updateRepoIndexUrl(request.url)
            SetRepoUrlResponse.newBuilder().setSuccess(true).build()
        } catch (e: Exception) {
            logger.error(e) { "Failed to set repo URL" }
            SetRepoUrlResponse
                .newBuilder()
                .setSuccess(false)
                .setError(e.message ?: "Unknown error")
                .build()
        }

    override suspend fun installExtension(request: InstallExtensionRequest): InstallExtensionResponse =
        try {
            val ext = extensionManager.installFromRepo(request.packageName)
            InstallExtensionResponse
                .newBuilder()
                .setSuccess(true)
                .setExtension(toExtensionInfo(ext))
                .build()
        } catch (e: Exception) {
            logger.error(e) { "Failed to install: ${request.packageName}" }
            InstallExtensionResponse
                .newBuilder()
                .setSuccess(false)
                .setError(e.message ?: "Unknown error")
                .build()
        }

    override suspend fun uninstallExtension(request: UninstallExtensionRequest): UninstallExtensionResponse =
        try {
            extensionManager.uninstall(request.packageName)
            UninstallExtensionResponse
                .newBuilder()
                .setSuccess(true)
                .build()
        } catch (e: Exception) {
            logger.error(e) { "Failed to uninstall: ${request.packageName}" }
            UninstallExtensionResponse
                .newBuilder()
                .setSuccess(false)
                .setError(e.message ?: "Unknown error")
                .build()
        }

    override suspend fun updateExtension(request: UpdateExtensionRequest): InstallExtensionResponse =
        try {
            val ext = extensionManager.update(request.packageName)
            InstallExtensionResponse
                .newBuilder()
                .setSuccess(true)
                .setExtension(toExtensionInfo(ext))
                .build()
        } catch (e: Exception) {
            logger.error(e) { "Failed to update: ${request.packageName}" }
            InstallExtensionResponse
                .newBuilder()
                .setSuccess(false)
                .setError(e.message ?: "Unknown error")
                .build()
        }

    override suspend fun listRepoExtensions(request: ListRepoExtensionsRequest): ListRepoExtensionsResponse =
        try {
            val extensions = extensionManager.listRepoExtensions()
            ListRepoExtensionsResponse
                .newBuilder()
                .addAllExtensions(extensions)
                .build()
        } catch (e: Exception) {
            logger.error(e) { "Failed to list repo extensions" }
            ListRepoExtensionsResponse
                .newBuilder()
                .build()
        }

    override suspend fun listSources(request: ListSourcesRequest): ListSourcesResponse {
        val sources = extensionManager.listSources()
        return ListSourcesResponse
            .newBuilder()
            .addAllSources(sources.map { toSourceInfo(it) })
            .build()
    }

    override suspend fun searchTitle(request: SearchTitleRequest): TitlesPageResponse =
        try {
            extensionManager.searchTitle(
                request.sourceId,
                request.query,
                request.page,
                request.filtersList.associate { it.key to it.value },
            )
        } catch (e: Exception) {
            logger.error(e) { "Search failed" }
            throw asGrpcException("search_title", e)
        }

    override suspend fun getPopularTitles(request: GetPopularTitlesRequest): TitlesPageResponse =
        try {
            extensionManager.getPopularTitles(request.sourceId, request.page)
        } catch (e: Exception) {
            logger.error(e) { "Get popular failed" }
            throw asGrpcException("get_popular_titles", e)
        }

    override suspend fun getLatestTitles(request: GetLatestTitlesRequest): TitlesPageResponse =
        try {
            extensionManager.getLatestTitles(request.sourceId, request.page)
        } catch (e: Exception) {
            logger.error(e) { "Get latest failed" }
            throw asGrpcException("get_latest_titles", e)
        }

    override suspend fun getTitleDetails(request: GetTitleDetailsRequest): TitleResponse =
        try {
            extensionManager.getTitleDetails(request.sourceId, request.titleUrl)
        } catch (e: Exception) {
            logger.error(e) { "Get details failed" }
            throw asGrpcException("get_title_details", e)
        }

    override suspend fun getChapterList(request: GetChaptersListRequest): ChaptersListResponse =
        try {
            extensionManager.getChaptersList(request.sourceId, request.titleUrl)
        } catch (e: Exception) {
            logger.error(e) { "Get chapters failed" }
            throw asGrpcException("get_chapter_list", e)
        }

    override suspend fun getPageList(request: GetPagesListRequest): PagesListResponse =
        try {
            extensionManager.getPagesList(request.sourceId, request.chapterUrl)
        } catch (e: Exception) {
            logger.error(e) { "Get pages failed" }
            throw asGrpcException("get_page_list", e)
        }

    override suspend fun getFilters(request: GetFiltersRequest): FiltersResponse =
        try {
            extensionManager.getFilters(request.sourceId)
        } catch (e: Exception) {
            logger.error(e) { "Get filters failed" }
            throw asGrpcException("get_filters", e)
        }

    override suspend fun getSearchFilters(request: GetFiltersRequest): FiltersResponse =
        try {
            extensionManager.getSearchFilters(request.sourceId)
        } catch (e: Exception) {
            logger.error(e) { "Get search filters failed" }
            throw asGrpcException("get_search_filters", e)
        }

    override suspend fun setPreference(request: SetPreferenceRequest): SetPreferenceResponse =
        try {
            extensionManager.setPreference(request.sourceId, request.key, request.value)
            SetPreferenceResponse
                .newBuilder()
                .setSuccess(true)
                .build()
        } catch (e: Exception) {
            logger.error(e) { "Set preference failed" }
            SetPreferenceResponse
                .newBuilder()
                .setSuccess(false)
                .setError(e.message ?: "Unknown error")
                .build()
        }

    override suspend fun healthCheck(request: HealthCheckRequest): HealthCheckResponse =
        HealthCheckResponse
            .newBuilder()
            .setStatus("OK")
            .setLoadedSources(extensionManager.listSources().size)
            .build()

    override suspend fun getFlareSolverrConfig(request: GetFlareSolverrConfigRequest): GetFlareSolverrConfigResponse {
        val config = ConfigManager.config.flareSolverr

        return GetFlareSolverrConfigResponse
            .newBuilder()
            .setConfig(
                FlareSolverrConfig
                    .newBuilder()
                    .setEnabled(config.enabled)
                    .setUrl(config.url)
                    .setTimeoutSeconds(config.timeoutSeconds)
                    .setResponseFallback(config.responseFallback)
                    .apply {
                        config.sessionName?.let { setSessionName(it) }
                        config.sessionTtlMinutes?.let { setSessionTtlMinutes(it) }
                    }.build(),
            ).build()
    }

    override suspend fun setFlareSolverrConfig(request: SetFlareSolverrConfigRequest): SetFlareSolverrConfigResponse =
        try {
            val config = request.config
            ConfigManager.updateFlareSolverr { _ ->
                mangarr.tachibridge.config.BridgeConfig.FlareSolverr(
                    enabled = config.enabled,
                    url = config.url,
                    timeoutSeconds = config.timeoutSeconds,
                    responseFallback = config.responseFallback,
                    sessionName = if (config.hasSessionName()) config.sessionName else null,
                    sessionTtlMinutes = if (config.hasSessionTtlMinutes()) config.sessionTtlMinutes else null,
                )
            }
            SetFlareSolverrConfigResponse
                .newBuilder()
                .setSuccess(true)
                .build()
        } catch (e: Exception) {
            logger.error(e) { "Failed to set FlareSolverr config" }
            SetFlareSolverrConfigResponse
                .newBuilder()
                .setSuccess(false)
                .setError(e.message ?: "Unknown error")
                .build()
        }

    private fun toExtensionInfo(ext: mangarr.tachibridge.config.BridgeConfig.InstalledExtension) =
        ExtensionInfo
            .newBuilder()
            .setPkgName(ext.packageName)
            .setName(ext.name)
            .setVersion(ext.version)
            .setLang(ext.lang)
            .setNsfw(ext.nsfw)
            .addAllSources(ext.sources.map { toSourceInfo(it) })
            .build()

    private fun toSourceInfo(source: mangarr.tachibridge.config.BridgeConfig.SourceInfo) =
        SourceInfo
            .newBuilder()
            .setId(source.id)
            .setName(source.name)
            .setLang(source.lang)
            .setIsNsfw(false)
            .setSupportsLatest(source.supportsLatest)
            .build()
}
