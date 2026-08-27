import { logs, SeverityNumber } from '@opentelemetry/api-logs';

const logger = logs.getLogger('eksdemo', '1.0.0');

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const severityMap: Record<LogLevel, SeverityNumber> = {
  DEBUG: SeverityNumber.DEBUG,
  INFO: SeverityNumber.INFO,
  WARN: SeverityNumber.WARN,
  ERROR: SeverityNumber.ERROR,
};

export function log(level: LogLevel, message: string, attributes: Record<string, string | number | boolean> = {}): void {
  logger.emit({
    severityNumber: severityMap[level],
    severityText: level,
    body: message,
    attributes,
  });
}

export function logInfo(message: string, attributes: Record<string, string | number | boolean> = {}): void {
  log('INFO', message, attributes);
}

export function logError(message: string, attributes: Record<string, string | number | boolean> = {}): void {
  log('ERROR', message, attributes);
}
