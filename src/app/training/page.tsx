import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import { currentAdmin } from '@/lib/server-auth';
import { readTrainingBootstrap, readTrainingRecovery, TrainingStateCorruptError } from '@/lib/training-store';
import { TrainingApp } from '@/components/training/TrainingApp';
import { RecoveryPanel } from '@/components/training/RecoveryPanel';
import './training.css';
import { publicPath } from '@/lib/urls';

export const metadata = { title: '私人网球训练', manifest: publicPath('/manifest.webmanifest'), appleWebApp: { capable: true, title: '网球训练' }, icons: { apple: publicPath('/training-icon-192.png') } };

export default async function TrainingPage() {
  await connection();
  const session = await currentAdmin();
  if (!session) redirect('/training/login/');
  let bootstrap;
  try { bootstrap = await readTrainingBootstrap(); }
  catch (error) {
    if (error instanceof TrainingStateCorruptError) return <RecoveryPanel revision={(await readTrainingRecovery()).revision}/>;
    throw error;
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return <TrainingApp initial={bootstrap} today={today} username={session.username}/>;
}
