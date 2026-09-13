const jwt = require("jsonwebtoken");

function requireAuth(req, res, next) {
  const authorization = req.get("Authorization");
  const [scheme, token] = authorization ? authorization.split(" ") : [];

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({
      success: false,
      message: "Authentication token is required",
    });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (!payload.userId || !payload.role) {
      throw new Error("Invalid token payload");
    }

    req.user = {
      userId: payload.userId,
      role: payload.role,
    };

    return next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token",
    });
  }
}

module.exports = requireAuth;