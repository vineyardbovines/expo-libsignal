# Keep all libsignal classes (used via reflection in some code paths)
-keep class org.signal.libsignal.** { *; }
-keep class org.whispersystems.** { *; }
-keepclassmembers class org.signal.libsignal.protocol.** { *; }
