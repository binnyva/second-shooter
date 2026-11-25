import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// The Firebase config is read from the Expo app's .env at the repo root, so
// both apps talk to the same project and nothing new has to be registered in
// the Firebase console (no google-services.json).
val expoEnv: Map<String, String> = rootProject.file("../.env").let { file ->
    if (!file.exists()) {
        emptyMap()
    } else {
        file.readLines()
            .map { it.trim() }
            .filter { it.isNotEmpty() && !it.startsWith("#") && it.contains('=') }
            .associate { line ->
                line.substringBefore('=').trim() to
                    line.substringAfter('=').trim().removeSurrounding("\"")
            }
    }
}

fun firebaseField(name: String): String {
    val value = expoEnv["EXPO_PUBLIC_FIREBASE_$name"].orEmpty()
    return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
}

android {
    namespace = "com.secondshooter.nativepoc"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.secondshooter.nativepoc"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        buildConfigField("String", "FIREBASE_API_KEY", firebaseField("API_KEY"))
        buildConfigField("String", "FIREBASE_APP_ID", firebaseField("APP_ID"))
        buildConfigField("String", "FIREBASE_PROJECT_ID", firebaseField("PROJECT_ID"))
        buildConfigField("String", "FIREBASE_STORAGE_BUCKET", firebaseField("STORAGE_BUCKET"))
        buildConfigField("String", "FIREBASE_MESSAGING_SENDER_ID", firebaseField("MESSAGING_SENDER_ID"))
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // A test app: sign release builds with the debug key so they install.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests.all {
            // The protocol examples shared with the web remote's Jest tests.
            // Declared as an input so editing them re-runs the tests.
            val fixtures = rootProject.file("../shared/protocol-fixtures.json")
            it.inputs.file(fixtures)
            it.systemProperty("protocolFixtures", fixtures.absolutePath)
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    val cameraX = "1.5.0"

    implementation(platform("androidx.compose:compose-bom:2025.06.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.1")
    implementation("androidx.navigation:navigation-compose:2.9.0")
    implementation("androidx.datastore:datastore-preferences:1.1.7")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")

    implementation("androidx.camera:camera-core:$cameraX")
    implementation("androidx.camera:camera-camera2:$cameraX")
    implementation("androidx.camera:camera-lifecycle:$cameraX")

    implementation("io.getstream:stream-webrtc-android:1.3.10")

    implementation(platform("com.google.firebase:firebase-bom:34.0.0"))
    implementation("com.google.firebase:firebase-auth")
    implementation("com.google.firebase:firebase-firestore")
    implementation("com.google.firebase:firebase-functions")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-guava:1.10.2")

    implementation("com.google.zxing:core:3.5.3")

    testImplementation("junit:junit:4.13.2")
}
