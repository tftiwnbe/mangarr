package mangarr.tachibridge.loader

import okhttp3.Headers
import okhttp3.OkHttpClient
import okhttp3.Request

object SourceAuthPatches {
	@JvmStatic
	fun isTokenValid(
		source: Any,
		token: String,
	): Boolean {
		val headers =
			Headers
				.Builder()
				.add("Accept", "application/json")
				.add("Authorization", token)
				.build()
		val client = invokeNoArg(source, "getClient") as OkHttpClient
		val authBaseUrl = readStringField(source, "apiDomain", "baseUrl")
		val request =
			Request
				.Builder()
				.url("${authBaseUrl.removeSuffix("/")}/api/auth/me")
				.headers(headers)
				.get()
				.build()

		client.newCall(request).execute().use { response ->
			if (response.code != 401) {
				return true
			}
		}

		throw Exception(
			"Попробуйте авторизоваться через WebView🌎︎. Для завершения авторизации может потребоваться перезапустить приложение с полной остановкой.",
		)
	}

	private fun invokeNoArg(
		target: Any,
		methodName: String,
	): Any? {
		var type: Class<*>? = target.javaClass
		while (type != null) {
			runCatching {
				type.getDeclaredMethod(methodName).apply { isAccessible = true }.invoke(target)
			}.getOrNull()?.let { return it }
			type = type.superclass
		}
		error("Could not invoke $methodName on ${target.javaClass.name}")
	}

	private fun readStringField(
		target: Any,
		vararg fieldNames: String,
	): String {
		for (fieldName in fieldNames) {
			var type: Class<*>? = target.javaClass
			while (type != null) {
				runCatching {
					type.getDeclaredField(fieldName).apply { isAccessible = true }.get(target) as? String
				}.getOrNull()?.takeIf { it.isNotBlank() }?.let { return it }
				type = type.superclass
			}
		}
		error("Could not read any of ${fieldNames.joinToString()} from ${target.javaClass.name}")
	}
}
