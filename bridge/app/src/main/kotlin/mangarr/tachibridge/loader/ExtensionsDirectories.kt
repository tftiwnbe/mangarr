package mangarr.tachibridge.loader

import java.nio.file.Path
import kotlin.io.path.Path
import kotlin.io.path.absolute
import kotlin.io.path.createDirectories

interface ExtensionsDirectories {
    val extensionsRoot: Path
}

interface MutableExtensionsDirectories : ExtensionsDirectories {
    fun updateRootDir(rootDir: String)
}

class ConfigExtensionsDirectories(
    rootDir: String,
) : MutableExtensionsDirectories {
    @Volatile
    private var currentRoot: Path = resolve(rootDir)

    init {
        currentRoot.createDirectories()
    }

    override val extensionsRoot: Path
        get() = currentRoot

    override fun updateRootDir(rootDir: String) {
        currentRoot = resolve(rootDir)
        currentRoot.createDirectories()
    }

    private fun resolve(rootDir: String): Path {
        val path = Path(rootDir)
        val normalized =
            if (path.isAbsolute) {
                path.normalize()
            } else {
                Path(System.getProperty("user.dir")).resolve(path).absolute().normalize()
            }
        return normalized
    }
}
