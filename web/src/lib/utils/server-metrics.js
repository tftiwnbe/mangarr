// @ts-check

/**
 * @param {unknown} metric
 */
export function onHttpRequestStarted(metric) {
	void metric;
}

/**
 * @param {unknown} metric
 */
export function onHttpRequestFinished(metric) {
	void metric;
}

/**
 * @param {unknown} metric
 */
export function recordBridgeRequest(metric) {
	void metric;
}

export function renderPrometheus() {
	return '';
}

export function metricsContentType() {
	return 'text/plain; charset=utf-8';
}

export function isMetricsEnabled() {
	return false;
}

/**
 * @param {unknown} enabled
 */
export function setMetricsEnabled(enabled) {
	void enabled;
}

export function resetServerMetrics() {
	return undefined;
}
