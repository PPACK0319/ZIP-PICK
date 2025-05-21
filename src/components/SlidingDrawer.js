import React from 'react';
import './SlidingDrawer.css';

export default function SlidingDrawer({ isOpen, onClose, children }) {
  return (
    <div className={`drawer ${isOpen ? 'open' : ''}`}>
      <button className="close-btn" onClick={onClose}>✕</button>
      <div className="drawer-content">
        {children}
      </div>
    </div>
  );
}
