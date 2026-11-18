import com.github.gradle.node.npm.task.NpmTask
import org.jetbrains.intellij.platform.gradle.TestFrameworkType

fun properties(key: String) = project.findProperty(key).toString()

plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.3.20"
    id("org.jetbrains.intellij.platform") version "2.19.0"
    id("com.github.node-gradle.node") version "7.1.0"
}

group = properties("pluginGroup")
version = properties("pluginVersion")

kotlin {
    jvmToolchain(25)
}

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        create(properties("platformType"), properties("platformVersion")) {
            useInstaller = !properties("platformVersion").endsWith("EAP-SNAPSHOT")
        }
        testFramework(TestFrameworkType.Platform)
    }
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.opentest4j:opentest4j:1.3.0")
}

intellijPlatform {
    // No settings pages yet; skip the slow headless IDE run.
    buildSearchableOptions = false

    pluginConfiguration {
        ideaVersion {
            sinceBuild = properties("pluginSinceBuild")
            untilBuild = provider { null }
        }
    }

    pluginVerification {
        ides {
            recommended()
        }
    }
}

/*
 * Web editor build (web/). Vite writes to build/generated/web-resources/web/, and that
 * directory's parent is a resources srcDir, so the bundle lands in the plugin jar under web/.
 * Uses the system node (download = false).
 */
node {
    download = false
    nodeProjectDir = file("web")
}

val webOutputRoot = layout.buildDirectory.dir("generated/web-resources")

val npmCi = tasks.register<NpmTask>("npmCi") {
    description = "Installs web/ dependencies from package-lock.json (npm ci)."
    npmCommand = listOf("ci")
    args = listOf("--no-audit", "--no-fund")
    inputs.files("web/package.json", "web/package-lock.json")
    // npm writes this file on each install; cheaper to track than all of node_modules.
    outputs.file("web/node_modules/.package-lock.json")
}

val webBuild = tasks.register<NpmTask>("webBuild") {
    description = "Builds the web editor bundle with Vite."
    dependsOn(npmCi)
    npmCommand = listOf("run", "build")
    inputs.dir("web/src")
    inputs.files(
        "web/index.html",
        "web/package-lock.json",
        "web/tsconfig.json",
        "web/vite.config.ts",
    )
    outputs.dir(webOutputRoot.map { it.dir("web") })
    outputs.cacheIf { true }
}

sourceSets {
    main {
        resources.srcDir(files(webOutputRoot).builtBy(webBuild))
    }
}

tasks {
    wrapper {
        gradleVersion = properties("gradleVersion")
        distributionType = Wrapper.DistributionType.BIN
    }
}

/*
 * L5 real-IDE end-to-end tests, run by scripts/e2e.sh. The tests start the
 * resolved IDE (bin/idea.sh) with the built plugin, drive the IDE through the Driver (JMX, served
 * by the bundled performanceTesting plugin) and the page through CDP (scripts/e2e/cdp.mjs).
 */
val uiTest: SourceSet by sourceSets.creating

dependencies {
    "uiTestImplementation"("com.jetbrains.intellij.driver:driver-client:261.22158.277")
    "uiTestImplementation"("com.jetbrains.intellij.driver:driver-model:261.22158.277")
    "uiTestImplementation"("org.jetbrains.kotlin:kotlin-stdlib:2.3.20")
    "uiTestImplementation"("org.jetbrains.kotlinx:kotlinx-serialization-json-jvm:1.9.0")
    "uiTestImplementation"("junit:junit:4.13.2")
}

tasks.register<Test>("uiTest") {
    description = "L5: runs the plugin in a real IDE with JCEF (use scripts/e2e.sh)."
    group = "verification"
    testClassesDirs = uiTest.output.classesDirs
    classpath = uiTest.runtimeClasspath
    val pluginZip = tasks.named<Zip>("buildPlugin").flatMap { it.archiveFile }
    inputs.file(pluginZip)
    systemProperty("markdone.e2e.ide", intellijPlatform.platformPath.toString())
    systemProperty("markdone.e2e.plugin", pluginZip.get().asFile.absolutePath)
    systemProperty("markdone.e2e.root", rootDir.absolutePath)
    // Options passed by scripts/e2e.sh (-Pmarkdone.e2e.*=...).
    for (key in listOf("markdone.e2e.modes", "markdone.e2e.huge")) {
        providers.gradleProperty(key).orNull?.let { systemProperty(key, it) }
    }
    outputs.upToDateWhen { false }
    reports.junitXml.outputLocation = layout.buildDirectory.dir("reports/e2e/junit")
    reports.html.outputLocation = layout.buildDirectory.dir("reports/e2e/html")
    testLogging.events("passed", "failed", "skipped")
}
