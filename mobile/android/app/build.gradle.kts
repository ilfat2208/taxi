plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

/**
 * Single place where the backend origin is configured.
 *
 * `-Ptaxi.api.baseUrl=http://192.168.1.10:8080` overrides it for a physical device;
 * the default is the Android emulator's alias for the host loopback interface.
 */
val apiBaseUrl: String =
    (project.findProperty("taxi.api.baseUrl") as String?) ?: "http://10.0.2.2:8080"

android {
    namespace = "kz.taxi.mobile"
    compileSdk = 34

    defaultConfig {
        applicationId = "kz.taxi.mobile"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"

        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            applicationIdSuffix = ".debug"
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
            excludes += "/META-INF/LICENSE.md"
            excludes += "/META-INF/LICENSE-notice.md"
        }
    }

    testOptions {
        unitTests {
            isReturnDefaultValues = true
        }
    }

    sourceSets {
        getByName("test") {
            resources.srcDir("src/test/resources")
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.datastore.preferences)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.retrofit)
    implementation(libs.retrofit.serialization)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}

/**
 * Unit tests run on the JVM. The live-backend test is opt-in and self-skips, so a normal
 * `gradlew test` never needs the gateway to be running:
 *
 * ```
 * .\gradlew.bat testDebugUnitTest -Dtaxi.liveTest=true
 * ```
 *
 * `-D...` on the Gradle command line only reaches the Gradle JVM, so the two properties the
 * test cares about are forwarded explicitly.
 */
tasks.withType<Test>().configureEach {
    listOf("taxi.liveTest", "taxi.api.baseUrl").forEach { key ->
        System.getProperty(key)?.let { value -> systemProperty(key, value) }
    }
    testLogging {
        events("passed", "failed", "skipped")
        showStandardStreams = true
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
    maxHeapSize = "1g"
}

/** Convenience alias: runs the whole unit-test suite including the live-backend test. */
tasks.register("liveBackendTest") {
    group = "verification"
    description = "Runs the unit tests plus the tagged live-backend test (needs -Dtaxi.liveTest=true)."
    dependsOn("testDebugUnitTest")
}
