plugins {
    id("java")
}

group = "com.example.kts"

dependencies {
    implementation(project(":core"))
    implementation("org.example:kts-lib:2.0")
}
