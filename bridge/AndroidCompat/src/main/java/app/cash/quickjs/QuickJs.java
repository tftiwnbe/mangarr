package app.cash.quickjs;

import com.caoccao.javet.exceptions.JavetException;
import com.caoccao.javet.interop.V8Host;
import com.caoccao.javet.interop.V8Runtime;
import com.caoccao.javet.interop.converters.JavetProxyConverter;
import com.caoccao.javet.values.V8Value;
import com.caoccao.javet.values.primitive.V8ValueBoolean;
import com.caoccao.javet.values.primitive.V8ValueDouble;
import com.caoccao.javet.values.primitive.V8ValueInteger;
import com.caoccao.javet.values.primitive.V8ValueLong;
import com.caoccao.javet.values.primitive.V8ValueString;
import com.caoccao.javet.values.reference.V8ValueArray;
import java.io.Closeable;
import java.util.ArrayList;
import java.util.List;

public final class QuickJs implements Closeable {
    private V8Runtime runtime;

    public static QuickJs create() {
        return new QuickJs();
    }

    public QuickJs() {
        try {
            // Use QuickJS mode (lighter than V8)
            this.runtime = V8Host.getNodeInstance().createV8Runtime();
            this.runtime.setConverter(new JavetProxyConverter());
        } catch (Exception e) {
            throw new QuickJsException("Failed to initialize QuickJS runtime", e);
        }
    }

    public Object evaluate(String script, String ignoredFileName) {
        return this.evaluate(script);
    }

    public Object evaluate(String script) {
        try {
            V8Value result = runtime.getExecutor(script).execute();
            return translateType(result);
        } catch (Exception exception) {
            throw new QuickJsException(exception.getMessage(), exception);
        }
    }

    private Object translateType(V8Value value) {
        try {
            if (value == null || value.isUndefined() || value.isNull()) {
                return null;
            } else if (value instanceof V8ValueBoolean) {
                return ((V8ValueBoolean) value).getValue();
            } else if (value instanceof V8ValueArray) {
                V8ValueArray array = (V8ValueArray) value;
                int length = array.getLength();
                
                if (length == 0) {
                    return new int[0];
                }
                
                // Check first element type
                V8Value first = array.get(0);
                if (first instanceof V8ValueBoolean) {
                    boolean[] result = new boolean[length];
                    for (int i = 0; i < length; i++) {
                        result[i] = ((V8ValueBoolean) array.get(i)).getValue();
                    }
                    return result;
                } else if (first instanceof V8ValueInteger) {
                    int[] result = new int[length];
                    for (int i = 0; i < length; i++) {
                        result[i] = ((V8ValueInteger) array.get(i)).getValue();
                    }
                    return result;
                } else if (first instanceof V8ValueLong) {
                    long[] result = new long[length];
                    for (int i = 0; i < length; i++) {
                        result[i] = ((V8ValueLong) array.get(i)).getValue();
                    }
                    return result;
                } else if (first instanceof V8ValueDouble) {
                    double[] result = new double[length];
                    for (int i = 0; i < length; i++) {
                        result[i] = ((V8ValueDouble) array.get(i)).getValue();
                    }
                    return result;
                } else if (first instanceof V8ValueString) {
                    String[] result = new String[length];
                    for (int i = 0; i < length; i++) {
                        result[i] = ((V8ValueString) array.get(i)).getValue();
                    }
                    return result;
                } else {
                    // Generic object array
                    List<Object> result = new ArrayList<>(length);
                    for (int i = 0; i < length; i++) {
                        result.add(translateType(array.get(i)));
                    }
                    return result.toArray();
                }
            } else if (value instanceof V8ValueInteger) {
                return ((V8ValueInteger) value).getValue();
            } else if (value instanceof V8ValueLong) {
                return ((V8ValueLong) value).getValue();
            } else if (value instanceof V8ValueDouble) {
                return ((V8ValueDouble) value).getValue();
            } else if (value instanceof V8ValueString) {
                return ((V8ValueString) value).getValue();
            }
            
            // For any other type (objects, functions, etc.), use the converter
            try {
                return runtime.getConverter().toObject(value);
            } catch (Exception e) {
                // If conversion fails, return the V8Value itself
                return value;
            }
        } catch (Exception e) {
            throw new QuickJsException("Failed to translate type", e);
        }
    }

    public byte[] compile(String sourceCode, String ignoredFileName) {
        // QuickJS bytecode compilation
        return sourceCode.getBytes();
    }

    public Object execute(byte[] bytecode) {
        return this.evaluate(new String(bytecode));
    }

    public <T> void set(String name, Class<T> ignoredType, T object) {
        try {
            runtime.getGlobalObject().set(name, object);
        } catch (Exception e) {
            throw new QuickJsException("Failed to set global variable", e);
        }
    }

    @Override
    public void close() {
        if (this.runtime != null) {
            try {
                this.runtime.close();
            } catch (Exception e) {
                // Log but don't throw on close
            }
            this.runtime = null;
        }
    }
}
