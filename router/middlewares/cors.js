// CORS中间件

/**
 * CORS中间件
 * 处理跨域请求，支持配置允许的源、方法、头信息等
 */
const config = {
  name: 'cors',
  level: ['global'],
  order: 10,
  enabled: true,
  exclude: [], // 不排除任何路径
  options: {
    origin: '*', // 允许的源，可以是字符串、数组或函数
    methods: 'GET,HEAD,PUT,POST,DELETE,PATCH', // 允许的HTTP方法
    headers: 'Content-Type,Authorization,X-Requested-With,Accept,Origin', // 允许的头信息
    credentials: true, // 是否允许凭证
    maxAge: 86400, // 预检请求的缓存时间（秒）
    exposeHeaders: 'Content-Length,X-Request-ID,X-Response-Time' // 暴露的头信息
  }
};

/**
 * 检查是否允许指定的源
 * @param {string} origin - 请求源
 * @param {string|Array|Function} allowedOrigins - 允许的源
 * @returns {string|null} - 允许的源或null
 */
function getAllowedOrigin(origin, allowedOrigins) {
  if (allowedOrigins === '*') {
    return '*';
  }

  if (Array.isArray(allowedOrigins)) {
    return allowedOrigins.includes(origin) ? origin : null;
  }

  if (typeof allowedOrigins === 'function') {
    return allowedOrigins(origin);
  }

  return allowedOrigins === origin ? origin : null;
}

/**
 * 设置CORS响应头
 * @param {Object} ctx - Koa上下文
 * @param {string} origin - 请求源
 */
function setCorsHeaders(ctx, origin) {
  const allowedOrigin = getAllowedOrigin(origin, config.options.origin);
  if (!allowedOrigin) {
    return;
  }

  // 设置CORS响应头
  ctx.set('Access-Control-Allow-Origin', allowedOrigin);
  ctx.set('Access-Control-Allow-Methods', config.options.methods);
  ctx.set('Access-Control-Allow-Headers', config.options.headers);
  ctx.set('Access-Control-Expose-Headers', config.options.exposeHeaders);
  ctx.set('Access-Control-Max-Age', config.options.maxAge.toString());

  if (config.options.credentials) {
    ctx.set('Access-Control-Allow-Credentials', 'true');
  }
}

/**
 * CORS中间件的onRequest钩子
 * @param {Object} ctx - Koa上下文
 */
async function onRequest(ctx) {
  const origin = ctx.headers.origin;
  if (!origin) {
    return; // 非跨域请求，跳过CORS处理
  }

  // 处理OPTIONS预检请求
  if (ctx.method === 'OPTIONS') {
    ctx.status = 204;
    ctx.body = '';
    setCorsHeaders(ctx, origin);
    return;
  }

  // 处理实际请求
  setCorsHeaders(ctx, origin);
}

/**
 * CORS中间件的onResponse钩子
 * @param {Object} ctx - Koa上下文
 */
async function onResponse(ctx) {
  // 确保在响应时也设置CORS头
  const origin = ctx.headers.origin;
  if (origin) {
    setCorsHeaders(ctx, origin);
  }
}

// 导出中间件
exports.config = config;
exports.onRequest = onRequest;
exports.onResponse = onResponse;