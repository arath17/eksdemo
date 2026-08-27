import { logs, SeverityNumber } from '@opentelemetry/api-logs';

const logger = logs.getLogger('eksdemo', '1.0.0');

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const severityMap: Record<LogLevel, SeverityNumber> = {
  DEBUG: SeverityNumber.DEBUG,
  INFO: SeverityNumber.INFO,
  WARN: SeverityNumber.WARN,
  ERROR: SeverityNumber.ERROR,
};

const consoleMethod: Record<LogLevel, (msg: string) => void> = {
  DEBUG: console.debug,
  INFO: console.info,
  WARN: console.warn,
  ERROR: console.error,
};

export function log(level: LogLevel, message: string, attributes: Record<string, string | number | boolean> = {}): void {
  logger.emit({
    severityNumber: severityMap[level],
    severityText: level,
    body: message,
    attributes,
  });

  // Also write to stdout/stderr so the logs are visible with `kubectl logs`.
  // This makes local debugging easier and provides a fallback if the OTLP
  // log pipeline is misconfigured.
  consoleMethod[level](JSON.stringify({ level, message, ...attributes }));
}

export function logInfo(message: string, attributes: Record<string, string | number | boolean> = {}): void {
  log('INFO', message, attributes);
}

export function logError(message: string, attributes: Record<string, string | number | boolean> = {}): void {
  log('ERROR', message, attributes);
}
