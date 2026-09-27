'use client';
import {useEffect} from 'react';import {useRouter} from 'next/navigation';
export default function Home(){const r=useRouter();useEffect(()=>r.replace(localStorage.getItem('token')?'/dashboard':'/login'),[r]);return <main className="min-h-screen grid place-items-center">Loading BizMind…</main>}
