// JWT认证中间件
const crypto = require('crypto');

/**
 * JWT认证中间件
 * 从请求头提取token，验证有效性，注入用户信息到ctx对象
 */
const config = {
  name: 'jwt-auth',
  level: ['protected'],
  order: 40,
  enabled: true,
  exclude: ['/public'] // 排除公开路径
};

/**
 * 生成JWT token
 * @param {Object} payload - token负载
 * @param {string} secret - 密钥
 * @param {number} expiresIn - 过期时间（秒）
 * @returns {string} - JWT token
 */
function generateToken(payload, secret, expiresIn = 3600) {
  // 设置过期时间
  const exp = Math.floor(Date.now() / 1000) + expiresIn;
  const claims = {
    ...payload,
    exp,
    iat: Math.floor(Date.now() / 1000)
  };

  // 生成header
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  // 生成payload
  const payloadStr = Buffer.from(JSON.stringify(claims)).toString('base64url');
  // 生成signature
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payloadStr}`)
    .digest('base64url');

  return `${header}.${payloadStr}.${signature}`;
}

/**
 * 验证JWT token
 * @param {string} token - JWT token
 * @param {string} secret - 密钥
 * @returns {Object|null} - 解析后的payload或null
 */
function verifyToken(token, secret) {
  try {
    const [header, payloadStr, signature] = token.split('.');
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${header}.${payloadStr}`)
      .digest('base64url');

    if (signature !== expectedSignature) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(payloadStr, 'base64url').toString());
    
    // 检查过期时间
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      return null;
    }

    return payload;
  } catch (error) {
    return null;
  }
}

/**
 * JWT认证中间件的before钩子
 * @param {Object} ctx - Koa上下文
 */
async function before(ctx) {
  // 获取JWT密钥（从环境变量或配置中获取）
  const secret = ctx.state.jwtSecret || process.env.JWT_SECRET || 'your-secret-key';
  
  // 从请求头提取token
  const authHeader = ctx.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    ctx.status = 401;
    ctx.body = {
      success: false,
      error: {
        message: 'Missing or invalid authorization header'
      }
    };
    return;
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token, secret);

  if (!payload) {
    ctx.status = 401;
    ctx.body = {
      success: false,
      error: {
        message: 'Invalid or expired token'
      }
    };
    return;
  }

  // 将解析后的用户信息注入到ctx对象
  ctx.user = payload;
  ctx.state.user = payload;
}

// 导出JWT工具函数，供其他模块使用
const jwtUtils = {
  generateToken,
  verifyToken
};

// 导出中间件
exports.config = config;
exports.before = before;
exports.jwtUtils = jwtUtils;