package mangarr.tachibridge.loader

import io.github.oshai.kotlinlogging.KotlinLogging
import org.objectweb.asm.ClassReader
import org.objectweb.asm.ClassVisitor
import org.objectweb.asm.ClassWriter
import org.objectweb.asm.FieldVisitor
import org.objectweb.asm.MethodVisitor
import org.objectweb.asm.Opcodes
import java.nio.file.FileSystems
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import kotlin.streams.asSequence

object BytecodeEditor {
    private val logger = KotlinLogging.logger {}

    private class SafeClassWriter(
        classReader: ClassReader,
        flags: Int,
    ) : ClassWriter(classReader, flags) {
        override fun getCommonSuperClass(
            type1: String,
            type2: String,
        ): String =
            runCatching { super.getCommonSuperClass(type1, type2) }.getOrElse {
                logger.debug(it) {
                    "Falling back to java/lang/Object while rewriting bytecode for $type1 and $type2"
                }
                "java/lang/Object"
            }
    }

    fun fixAndroidClasses(jarFile: Path) {
        FileSystems.newFileSystem(jarFile, null as ClassLoader?)?.use { fs ->
            Files.walk(fs.getPath("/")).use { stream ->
                stream
                    .asSequence()
                    .filterNotNull()
                    .filterNot(Files::isDirectory)
                    .mapNotNull(::getClassBytes)
                    .map(::transform)
                    .forEach(::write)
            }
        }
    }

    private fun getClassBytes(path: Path): Pair<Path, ByteArray>? {
        return try {
            if (path.toString().endsWith(".class")) {
                val bytes = Files.readAllBytes(path)
                if (bytes.size < 4) return null
                val cafebabe =
                    String.format(
                        "%02X%02X%02X%02X",
                        bytes[0],
                        bytes[1],
                        bytes[2],
                        bytes[3],
                    )
                if (cafebabe.lowercase() != "cafebabe") {
                    return null
                }

                path to bytes
            } else {
                null
            }
        } catch (e: Exception) {
            logger.error(e) { "Error loading class from Path: $path" }
            null
        }
    }

    private const val REPLACEMENT_PATH = "xyz/nulldev/androidcompat/replace"

    private val classesToReplace =
        listOf(
            "java/text/SimpleDateFormat",
        )

    private fun String?.replaceDirectly() =
        when (this) {
            null -> null
            in classesToReplace -> "$REPLACEMENT_PATH/$this"
            else -> this
        }

    private fun String?.replaceIndirectly(): String? {
        if (this == null) return null
        var classReference: String = this
        classesToReplace.forEach {
            classReference = classReference.replace(it, "$REPLACEMENT_PATH/$it")
        }
        return classReference
    }

    private fun transform(pair: Pair<Path, ByteArray>): Pair<Path, ByteArray> {
        val cr = ClassReader(pair.second)
        val cw = SafeClassWriter(cr, ClassWriter.COMPUTE_MAXS or ClassWriter.COMPUTE_FRAMES)
        cr.accept(
            object : ClassVisitor(Opcodes.ASM5, cw) {
                override fun visitField(
                    access: Int,
                    name: String?,
                    desc: String?,
                    signature: String?,
                    cst: Any?,
                ): FieldVisitor? {
                    return super.visitField(access, name, desc.replaceIndirectly(), signature, cst)
                }

                override fun visitMethod(
                    access: Int,
                    name: String,
                    desc: String,
                    signature: String?,
                    exceptions: Array<String?>?,
                ): MethodVisitor {
                    val mv =
                        super.visitMethod(
                            access,
                            name,
                            desc.replaceIndirectly(),
                            signature,
                            exceptions,
                        )
                    return object : MethodVisitor(Opcodes.ASM5, mv) {
                        override fun visitTypeInsn(
                            opcode: Int,
                            type: String?,
                        ) {
                            super.visitTypeInsn(opcode, type.replaceDirectly())
                        }

                        override fun visitFieldInsn(
                            opcode: Int,
                            owner: String?,
                            name: String?,
                            descriptor: String?,
                        ) {
                            super.visitFieldInsn(
                                opcode,
                                owner.replaceDirectly(),
                                name,
                                descriptor.replaceIndirectly(),
                            )
                        }

                        override fun visitInvokeDynamicInsn(
                            name: String?,
                            descriptor: String?,
                            bsm: org.objectweb.asm.Handle?,
                            vararg bsmArgs: Any?,
                        ) {
                            super.visitInvokeDynamicInsn(
                                name,
                                descriptor.replaceIndirectly(),
                                bsm,
                                *bsmArgs,
                            )
                        }

                        override fun visitMethodInsn(
                            opcode: Int,
                            owner: String?,
                            name: String?,
                            descriptor: String?,
                            isInterface: Boolean,
                        ) {
                            super.visitMethodInsn(
                                opcode,
                                owner.replaceDirectly(),
                                name,
                                descriptor.replaceIndirectly(),
                                isInterface,
                            )
                        }
                    }
                }
            },
            0,
        )
        return pair.first to cw.toByteArray()
    }

    private fun write(pair: Pair<Path, ByteArray>) {
        Files
            .newByteChannel(
                pair.first,
                StandardOpenOption.WRITE,
                StandardOpenOption.TRUNCATE_EXISTING,
            ).use { channel ->
                channel.write(java.nio.ByteBuffer.wrap(pair.second))
            }
    }
}
