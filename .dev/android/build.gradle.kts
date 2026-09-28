plugins { kotlin("jvm") version "1.9.25" }
repositories { mavenCentral() }
val app = file("../../android/app/src/main/java").absolutePath
val appTest = file("../../android/app/src/test/java").absolutePath
sourceSets {
  test { kotlin.srcDirs("src/test/kotlin", appTest); java.srcDirs("src/test/java", appTest) }
  main {
    kotlin.srcDirs(app, "stubs", "build/gen")
    java.srcDirs(app, "stubs", "build/gen")
  }
}
dependencies {
  compileOnly(files("libs/android.jar"))
  compileOnly(files("libs/coil-base.jar", "libs/coil.jar", "libs/coil-gif.jar", "libs/coil-video.jar"))
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
  testImplementation("junit:junit:4.13.2")
  testImplementation("org.robolectric:robolectric:4.14.1") { exclude(group = "androidx.test"); exclude(group = "androidx.test.espresso") }
  testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
  testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
  testImplementation("org.robolectric:android-all:15-robolectric-12650502")
}
tasks.withType<Test>().configureEach {
  systemProperty("robolectric.enabledSdks", "35")
  systemProperty("shots.dir", project.file("build/shots").absolutePath)
  systemProperty("shots.full", System.getProperty("shots.full") ?: "0")
  systemProperty("shots.only", System.getProperty("shots.only") ?: "")
  testLogging { events("failed"); exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL; showStandardStreams = true }
  outputs.upToDateWhen { false }
}
kotlin { jvmToolchain(21) }
tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
  kotlinOptions { jvmTarget = "21"; freeCompilerArgs += listOf("-Xnullability-annotations=@android.annotation:warn", "-Xnullability-annotations=@libcore.util:warn") }
}
tasks.withType<JavaCompile>().configureEach { sourceCompatibility = "21"; targetCompatibility = "21"; options.compilerArgs.add("-proc:none") }
