package mangarr.tachibridge.loader

import okhttp3.Headers
import okhttp3.OkHttpClient
import okhttp3.Request

object LibGroupPatches {
	@JvmStatic
	fun isUserTokenValid(
		libGroupSource: Any,
		token: String,
	): Boolean {
		val headers =
			Headers
				.Builder()
				.add("Accept", "application/json")
				.add("Authorization", token)
				.build()
		val client = invokeNoArg(libGroupSource, "getClient") as OkHttpClient
		val apiDomain = getStringField(libGroupSource, "apiDomain")
		val request =
			Request
				.Builder()
				.url("${apiDomain.removeSuffix("/")}/api/auth/me")
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

	private fun getStringField(
		target: Any,
		fieldName: String,
	): String {
		var type: Class<*>? = target.javaClass
		while (type != null) {
			runCatching {
				type.getDeclaredField(fieldName).apply { isAccessible = true }.get(target) as? String
			}.getOrNull()?.let { return it }
			type = type.superclass
		}
		error("Could not read $fieldName from ${target.javaClass.name}")
	}
}
