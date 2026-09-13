import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { query } from './db.js';
import auth from './routes/auth.js';
import data from './routes/data.js';
dotenv.config({ path: 'server/.env' });
const app=express();
const allowedOrigins = new Set([
	process.env.CLIENT_URL,
	'http://localhost:3000',
	'http://localhost:3001',
	'http://localhost:3002',
	'http://localhost:3003',
	'http://localhost:3004'
]);
const corsOptions = {
	origin: (origin, callback) => {
		if (!origin || allowedOrigins.has(origin)) return callback(null, true);
		return callback(new Error('Origin is not allowed by BoardEase API CORS policy.'));
	},
	credentials: true,
	methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
	allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({limit:'2mb'})); app.use(cookieParser());
app.get('/api/health',async(_req,res)=>{try{await query('SELECT 1');res.json({data:{status:'ok',database:'connected'}});}catch{res.status(503).json({error:'Database unavailable.'});}});
app.use('/api/auth',auth); app.use('/api',data);
app.use((err,_req,res,_next)=>{console.error(err);res.status(err.status||500).json({error:err.status?err.message:'Unexpected server error.'});});
const port=Number(process.env.PORT||5000); app.listen(port,()=>console.log(`BoardEase API listening on http://localhost:${port}`));
