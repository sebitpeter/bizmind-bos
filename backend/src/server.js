require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { auth } = require('./middleware/auth');
const app = express();
const prisma = new PrismaClient();
app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json());

function token(user){ return jwt.sign({id:user.id,businessId:user.businessId,role:user.role}, process.env.JWT_SECRET, {expiresIn:'7d'}); }

app.get('/api/health',(req,res)=>res.json({ok:true,service:'BizMind BOS API'}));

app.post('/api/auth/register', async (req,res)=>{
  try {
    const {name,email,password,businessName}=req.body;
    if(!name||!email||!password||!businessName) return res.status(400).json({message:'Name, email, password and business name are required'});
    if(await prisma.user.findUnique({where:{email}})) return res.status(409).json({message:'Email already registered'});
    const business=await prisma.business.create({data:{name:businessName,email}});
    const passwordHash=await bcrypt.hash(password,10);
    const user=await prisma.user.create({data:{name,email,passwordHash,businessId:business.id}});
    res.status(201).json({token:token(user),user:{id:user.id,name:user.name,email:user.email,businessId:user.businessId}});
  } catch(e){res.status(500).json({message:e.message});}
});

app.post('/api/auth/login', async (req,res)=>{
  try{
    const {email,password}=req.body; const user=await prisma.user.findUnique({where:{email}});
    if(!user || !(await bcrypt.compare(password,user.passwordHash))) return res.status(401).json({message:'Invalid email or password'});
    res.json({token:token(user),user:{id:user.id,name:user.name,email:user.email,businessId:user.businessId}});
  }catch(e){res.status(500).json({message:e.message});}
});

app.get('/api/dashboard',auth,async(req,res)=>{
  const bid=req.user.businessId;
  const [business,products,customers,sales,invoices]=await Promise.all([
    prisma.business.findUnique({where:{id:bid}}),
    prisma.product.findMany({where:{businessId:bid},orderBy:{createdAt:'desc'}}),
    prisma.customer.count({where:{businessId:bid}}),
    prisma.sale.findMany({where:{businessId:bid},orderBy:{createdAt:'desc'},take:100}),
    prisma.invoice.findMany({where:{businessId:bid},orderBy:{createdAt:'desc'},take:100})
  ]);
  const revenue=sales.reduce((a,s)=>a+s.total,0); const lowStock=products.filter(p=>p.stockQuantity<=p.reorderLevel);
  res.json({business,revenue,orders:sales.length,customers,invoiceCount:invoices.length,lowStock,products});
});

app.get('/api/products',auth,async(req,res)=>res.json(await prisma.product.findMany({where:{businessId:req.user.businessId},orderBy:{createdAt:'desc'}})));
app.post('/api/products',auth,async(req,res)=>{
  try{const {name,sku,category,sellingPrice,costPrice=0,stockQuantity=0,reorderLevel=5}=req.body; const p=await prisma.product.create({data:{name,sku,category,sellingPrice:Number(sellingPrice),costPrice:Number(costPrice),stockQuantity:Number(stockQuantity),reorderLevel:Number(reorderLevel),businessId:req.user.businessId}}); res.status(201).json(p);}catch(e){res.status(400).json({message:e.message});}
});
app.put('/api/products/:id',auth,async(req,res)=>{try{const p=await prisma.product.updateMany({where:{id:Number(req.params.id),businessId:req.user.businessId},data:req.body});res.json(p);}catch(e){res.status(400).json({message:e.message});}});
app.delete('/api/products/:id',auth,async(req,res)=>{await prisma.product.deleteMany({where:{id:Number(req.params.id),businessId:req.user.businessId}});res.status(204).end();});

app.get('/api/customers',auth,async(req,res)=>res.json(await prisma.customer.findMany({where:{businessId:req.user.businessId},orderBy:{createdAt:'desc'}})));
app.post('/api/customers',auth,async(req,res)=>{try{const c=await prisma.customer.create({data:{...req.body,businessId:req.user.businessId}});res.status(201).json(c);}catch(e){res.status(400).json({message:e.message});}});

app.post('/api/sales',auth,async(req,res)=>{
  try{
    const {items,paymentMethod='CASH'}=req.body; if(!Array.isArray(items)||!items.length) return res.status(400).json({message:'At least one item is required'});
    const result=await prisma.$transaction(async tx=>{
      let total=0; const normalized=[];
      for(const i of items){const p=await tx.product.findFirst({where:{id:Number(i.productId),businessId:req.user.businessId}}); if(!p) throw new Error('Product not found'); if(p.stockQuantity<Number(i.quantity)) throw new Error(`Insufficient stock for ${p.name}`); const q=Number(i.quantity); total+=q*p.sellingPrice; normalized.push({productId:p.id,quantity:q,unitPrice:p.sellingPrice});}
      const sale=await tx.sale.create({data:{total,paymentMethod,businessId:req.user.businessId,items:{create:normalized}}});
      for(const i of normalized){await tx.product.update({where:{id:i.productId},data:{stockQuantity:{decrement:i.quantity}}});await tx.inventoryTransaction.create({data:{productId:i.productId,type:'SALE',quantity:-i.quantity,note:`Sale #${sale.id}`}});}
      return sale;
    }); res.status(201).json(result);
  }catch(e){res.status(400).json({message:e.message});}
});

app.post('/api/inventory/:id',auth,async(req,res)=>{try{const product=await prisma.product.findFirst({where:{id:Number(req.params.id),businessId:req.user.businessId}});if(!product)return res.status(404).json({message:'Product not found'});const q=Number(req.body.quantity);if(!q)return res.status(400).json({message:'Quantity required'});const p=await prisma.product.update({where:{id:product.id},data:{stockQuantity:{increment:q}}});await prisma.inventoryTransaction.create({data:{productId:p.id,type:'RESTOCK',quantity:q,note:req.body.note||'Restock'}});res.json(p);}catch(e){res.status(400).json({message:e.message});}});

app.get('/api/invoices',auth,async(req,res)=>res.json(await prisma.invoice.findMany({where:{businessId:req.user.businessId},include:{customer:true,items:{include:{product:true}}},orderBy:{createdAt:'desc'}})));
app.post('/api/invoices',auth,async(req,res)=>{try{const {customerId,items,tax=0,dueDate}=req.body;if(!items?.length)return res.status(400).json({message:'Items required'});let subtotal=0;const rows=items.map(i=>{const sub=Number(i.quantity)*Number(i.unitPrice);subtotal+=sub;return {...i,quantity:Number(i.quantity),unitPrice:Number(i.unitPrice),subtotal:sub,productId:Number(i.productId)}});const count=await prisma.invoice.count({where:{businessId:req.user.businessId}});const inv=await prisma.invoice.create({data:{invoiceNumber:`INV-${String(count+1).padStart(5,'0')}`,subtotal,tax:Number(tax),total:subtotal+Number(tax),dueDate:dueDate?new Date(dueDate):undefined,customerId:customerId?Number(customerId):undefined,businessId:req.user.businessId,items:{create:rows}}});res.status(201).json(inv);}catch(e){res.status(400).json({message:e.message});}});

app.get('/api/forecast/:productId',auth,async(req,res)=>{
  try{
    const product=await prisma.product.findFirst({where:{id:Number(req.params.productId),businessId:req.user.businessId}}); if(!product)return res.status(404).json({message:'Product not found'});
    const sales=await prisma.saleItem.findMany({where:{productId:product.id,sale:{businessId:req.user.businessId}},include:{sale:true},orderBy:{sale:{createdAt:'asc'}}});
    const byDate={}; for(const s of sales){const d=s.sale.createdAt.toISOString().slice(0,10);byDate[d]=(byDate[d]||0)+s.quantity;}
    const payload={productId:product.id,history:Object.entries(byDate).map(([date,quantity])=>({date,quantity}))};
    const response=await fetch(`${process.env.AI_SERVICE_URL}/forecast`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}); if(!response.ok)throw new Error('AI service unavailable');
    const ai=await response.json(); res.json({product, ...ai});
  }catch(e){res.status(503).json({message:e.message});}
});

const port=process.env.PORT||4000;app.listen(port,()=>console.log(`BizMind API running on http://localhost:${port}`));
