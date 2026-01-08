// 日志中间件

/**
 * 日志中间件
 * 记录请求的方法、URL、IP、响应时间等信息
 */
const config = {
  name: 'logger',
  level: ['global'],
  order: 1,
  enabled: true,
  exclude: [], // 不排除任何路径
  options: {
    logLevel: 'info', // 日志级别：debug, info, warn, error
    format: 'combined' // 日志格式：combined, simple
  }
};

/**
 * 格式化日期时间
 * @param {Date} date - 日期对象
 * @returns {string} - 格式化后的日期字符串
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
}

/**
 * 获取客户端IP地址
 * @param {Object} ctx - Koa上下文
 * @returns {string} - 客户端IP地址
 */
function getClientIP(ctx) {
  return ctx.headers['x-forwarded-for'] || 
         ctx.headers['x-real-ip'] || 
         (ctx.socket && ctx.socket.remoteAddress) || 
         'unknown';
}

/**
 * 格式化日志
 * @param {Object} ctx - Koa上下文
 * @param {number} startTime - 请求开始时间
 * @param {string} format - 日志格式
 * @returns {string} - 格式化后的日志字符串
 */
function formatLog(ctx, startTime, format = 'combined') {
  const endTime = Date.now();
  const responseTime = endTime - startTime;
  const date = formatDate(new Date(startTime));
  const ip = getClientIP(ctx);
  const method = ctx.method;
  const url = ctx.url;
  const status = ctx.status;
  const contentLength = ctx.length || 0;
  const userAgent = ctx.headers['user-agent'] || '';

  if (format === 'simple') {
    return `${date} [INFO] ${method} ${url} ${status} ${responseTime}ms`;
  }

  // combined格式
  return `${date} [INFO] ${ip} - ${method} ${url} ${status} ${contentLength} "${userAgent}" ${responseTime}ms`;
}

/**
 * 记录日志
 * @param {string} message - 日志消息
 * @param {string} level - 日志级别
 */
function log(message, level = 'info') {
  // 简单的日志实现，生产环境可以替换为更强大的日志库
  console.log(message);
}

/**
 * 日志中间件的onRequest钩子
 * @param {Object} ctx - Koa上下文
 */
async function onRequest(ctx) {
  // 记录请求开始时间
  ctx.state.startTime = Date.now();
}

/**
 * 日志中间件的onResponse钩子
 * @param {Object} ctx - Koa上下文
 */
async function onResponse(ctx) {
  const startTime = ctx.state.startTime || Date.now();
  const logMessage = formatLog(ctx, startTime, config.options.format);
  log(logMessage, config.options.logLevel);
}

/**
 * 日志中间件的onError钩子
 * @param {Object} ctx - Koa上下文
 * @param {Error} error - 错误对象
 */
async function onError(ctx, error) {
  const startTime = ctx.state.startTime || Date.now();
  const logMessage = `${formatDate(new Date(startTime))} [ERROR] ${getClientIP(ctx)} - ${ctx.method} ${ctx.url} ${ctx.status || 500} - ${error.message}`;
  log(logMessage, 'error');
}

// 导出中间件
exports.config = config;
exports.onRequest = onRequest;
exports.onResponse = onResponse;
exports.onError = onError;