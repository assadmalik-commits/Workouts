import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import WorkoutTracker from './WorkoutTracker.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WorkoutTracker />
  </React.StrictMode>
);
