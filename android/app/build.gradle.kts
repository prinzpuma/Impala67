import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "org.impala67.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "org.impala67.app"
        minSdk = 26
        targetSdk = 37
        // Setzt .github/scripts/set-version.mjs beim Release.
        versionCode = 202087
        versionName = "2.2.87"
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
    }

    buildFeatures { compose = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // Schlüssel: Umgebung (CI) vor key.properties vor dem mitgelieferten release.keystore.
    signingConfigs {
        create("release") {
            val props = Properties()
            listOf(rootProject.file("key.properties"), file("key.properties")).firstOrNull { it.exists() }
                ?.inputStream()?.use(props::load)
            fun value(env: String, prop: String) = System.getenv(env) ?: props.getProperty(prop)
            var path = value("ANDROID_KEYSTORE_PATH", "storeFile")
            var storePass = value("ANDROID_KEYSTORE_PASSWORD", "storePassword")
            var alias = value("ANDROID_KEY_ALIAS", "keyAlias")
            var keyPass = value("ANDROID_KEY_PASSWORD", "keyPassword")
            if (path == null && file("release.keystore").exists()) {
                path = "release.keystore"
                storePass = storePass ?: "impala67release"
                alias = alias ?: "impala67"
                keyPass = keyPass ?: "impala67release"
            }
            path?.let(::file)?.takeIf { it.exists() }?.let {
                storeFile = it
                storePassword = storePass.orEmpty()
                keyAlias = alias.orEmpty()
                keyPassword = keyPass.orEmpty()
            }
        }
    }

    buildTypes {
        release {
            val release = signingConfigs.getByName("release")
            signingConfig = if (release.storeFile != null) release else signingConfigs.getByName("debug")
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    packaging {
        resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.okhttp)
    implementation(libs.play.services.auth)

    implementation(platform(libs.compose.bom))
    implementation(libs.bundles.compose)
    implementation(libs.bundles.navigation3)
    implementation(libs.bundles.ink)
    debugImplementation(libs.compose.ui.tooling)

    implementation("${libs.jna.get()}@aar")
}
