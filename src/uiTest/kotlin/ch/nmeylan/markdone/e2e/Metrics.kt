package ch.nmeylan.markdone.e2e

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlin.io.path.createDirectories
import kotlin.io.path.exists
import kotlin.io.path.readText
import kotlin.io.path.writeText
import kotlin.math.roundToLong

/**
 * Numbers measured by the L5 tests, in `build/reports/e2e/metrics-<group>.json` (flat
 * `{key: number}`). `scripts/e2e.sh` merges group `inprocess` into `build/reports/perf.json`.
 */
object Metrics {
    @Synchronized
    fun put(group: String, key: String, value: Double) {
        val file = E2e.reports.resolve("metrics-$group.json")
        E2e.reports.createDirectories()
        val current = if (file.exists()) Json.parseToJsonElement(file.readText()).jsonObject else JsonObject(emptyMap())
        val rounded = (value * 10).roundToLong() / 10.0
        file.writeText(JsonObject(current + (key to JsonPrimitive(rounded))).toString() + "\n")
        E2e.log("metric [$group] $key = $rounded")
    }

    fun median(values: List<Double>): Double = values.sorted().let { s ->
        if (s.size % 2 == 1) s[s.size / 2] else (s[s.size / 2 - 1] + s[s.size / 2]) / 2
    }

    /** Nearest-rank 95th percentile. */
    fun p95(values: List<Double>): Double = values.sorted().let { s -> s[(kotlin.math.ceil(0.95 * s.size).toInt() - 1).coerceIn(0, s.size - 1)] }
}
