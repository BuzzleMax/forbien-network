import React from 'react';
import { SystemChecker } from '../components/SystemChecker';
import { useApp } from '../context/AppContext';

export function SystemGateScreen() {
  const { completeSystemCheck } = useApp();
  return <SystemChecker onComplete={completeSystemCheck} />;
}
