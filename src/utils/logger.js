"use strict";

const { createLogger, format, transports } = require("winston");
const config = require("../config");

const { combine, timestamp, colorize, printf, errors } = format;

const logFormat = printf(({ level, message, timestamp: ts, stack, ...meta }) => {
  let line = `${ts} [${level}] ${message}`;
  if (Object.keys(meta).length > 0) line += ` ${JSON.stringify(meta)}`;
  if (stack) line += `\n${stack}`;
  return line;
});

const logger = createLogger({
  level: config.logLevel,
  format: combine(
    errors({ stack: true }),
    timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
    colorize(),
    logFormat
  ),
  transports: [new transports.Console()],
  exitOnError: false,
});

/**
 * Crée un logger avec préfixe de module.
 * @param {string} module
 */
logger.child = function (module) {
  return {
    debug: (msg, meta = {}) => logger.debug(`[${module}] ${msg}`, meta),
    info:  (msg, meta = {}) => logger.info( `[${module}] ${msg}`, meta),
    warn:  (msg, meta = {}) => logger.warn( `[${module}] ${msg}`, meta),
    error: (msg, meta = {}) => logger.error(`[${module}] ${msg}`, meta),
  };
};

module.exports = logger;
