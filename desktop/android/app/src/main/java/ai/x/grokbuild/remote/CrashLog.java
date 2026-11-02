package ai.x.grokbuild.remote;

import android.content.Context;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;

final class CrashLog {
    private static final String FILE_NAME = "last-crash.txt";

    private CrashLog() {}

    static void install(Context context) {
        Context appContext = context.getApplicationContext();
        Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try {
                StringWriter stack = new StringWriter();
                error.printStackTrace(new PrintWriter(stack));
                try (FileOutputStream output = appContext.openFileOutput(FILE_NAME, Context.MODE_PRIVATE)) {
                    output.write(stack.toString().getBytes(StandardCharsets.UTF_8));
                }
            } catch (Exception ignored) {}
            if (previous != null) previous.uncaughtException(thread, error);
        });
    }

    static String consume(Context context) {
        File file = new File(context.getFilesDir(), FILE_NAME);
        if (!file.isFile()) return null;
        try (FileInputStream input = new FileInputStream(file);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            String report = output.toString(StandardCharsets.UTF_8.name());
            return report.length() > 12000 ? report.substring(0, 12000) : report;
        } catch (Exception ignored) {
            return null;
        } finally {
            file.delete();
        }
    }
}
