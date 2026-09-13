import jwt from 'jsonwebtoken';

const secret = () => process.env.JWT_SECRET || 'development-only-change-me';
export function authenticate(req, res, next) {
  const token = req.cookies?.boardease_token;
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  try { req.user = jwt.verify(token, secret()); next(); }
  catch { return res.status(401).json({ error: 'Invalid or expired session.' }); }
}
export function authorize(...roles) {
  return (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'You are not allowed to perform this action.' });
}
export const signUser = user => jwt.sign({ id: user.id, role: user.role, email: user.email }, secret(), { expiresIn: '7d' });
