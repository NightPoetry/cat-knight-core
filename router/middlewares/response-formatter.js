// 响应格式化中间件

/**
 * 响应格式化中间件
 * 将路由处理函数的返回值自动包装成统一的格式，确保API响应格式一致
 */
const config = {
  name: 'response-formatter',
  level: ['global'],
  order: -2, // 负数优先级，在错误处理之前执行
  enabled: true,
  exclude: [], // 不排除任何路径
  options: {
    format: 'json', // 响应格式：json
    successKey: 'success', // 成功标志键名
    dataKey: 'data', // 数据键名
    timestampKey: 'timestamp', // 时间戳键名
    statusKey: 'status', // 状态键名
    wrapAlways: true, // 始终包装响应，即使返回值为null或undefined
    ignoreFields: [], // 忽略的字段
    addTimestamp: true, // 添加时间戳
    defaultStatus: 200 // 默认成功状态码
  }
};

/**
 * 检查是否需要包装响应
 * @param {any} body - 响应体
 * @returns {boolean} - 是否需要包装
 */
function shouldWrapResponse(body) {
  if (!config.options.wrapAlways && (body == null)) {
    return false;
  }

  // 如果已经是格式化的响应，不再包装
  if (typeof body === 'object' && body !== null && 'success' in body) {
    return false;
  }

  return true;
}

/**
 * 格式化响应
 * @param {any} data - 响应数据
 * @param {Object} ctx - Koa上下文
 * @returns {Object} - 格式化后的响应
 */
function formatResponse(data, ctx) {
  const formattedResponse = {
    [config.options.successKey]: true
  };

  // 添加数据字段
  if (data !== undefined && data !== null) {
    formattedResponse[config.options.dataKey] = data;
  }

  // 添加状态码
  const status = ctx.status || config.options.defaultStatus;
  formattedResponse[config.options.statusKey] = status;

  // 添加时间戳
  if (config.options.addTimestamp) {
    formattedResponse[config.options.timestampKey] = Date.now();
  }

  return formattedResponse;
}

/**
 * 响应格式化中间件的after钩子
 * @param {Object} ctx - Koa上下文
 */
async function after(ctx) {
  // 只有成功状态码（200-299）才需要格式化
  if (ctx.status >= 400) {
    return;
  }

  // 获取响应体
  let body = ctx.body;

  // 检查是否需要包装响应
  if (shouldWrapResponse(body)) {
    // 格式化响应
    ctx.body = formatResponse(body, ctx);
    
    // 确保状态码正确
    ctx.status = ctx.status || config.options.defaultStatus;
    
    // 确保响应类型正确
    ctx.set('Content-Type', 'application/json');
  }
}

/**
 * 响应格式化中间件的onResponse钩子
 * @param {Object} ctx - Koa上下文
 */
async function onResponse(ctx) {
  // 确保响应头正确
  if (!ctx.get('Content-Type')) {
    ctx.set('Content-Type', 'application/json');
  }
}

// 导出中间件
exports.config = config;
exports.after = after;
exports.onResponse = onResponse;