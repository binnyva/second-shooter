# WebRTC is mostly JNI: native code finds Java classes, methods and fields by
# name, so R8 must leave all of it alone.
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**

# Firebase, CameraX, kotlinx.serialization and Compose ship their own
# consumer rules.

# The protocol types are looked up by kotlinx.serialization's generated
# serializers; keep their names so @SerialName mapping and error messages
# stay readable.
-keep class com.secondshooter.app.protocol.** { *; }
