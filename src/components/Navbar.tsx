import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import type { AppView } from '../types';

interface NavbarProps {
  currentView: AppView;
  coursePrice: number;
  isAvailable: boolean;
  onNavigate: (view: AppView, sectionId?: string) => void;
}

export default function Navbar({
  currentView,
  coursePrice,
  isAvailable,
  onNavigate,
}: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLink = (view: AppView, sectionId?: string) => {
    setMobileOpen(false);
    onNavigate(view, sectionId);
  };

  return (
    <header className="sticky top-0 z-40 bg-[#09090B]/95 backdrop-blur-md border-b border-zinc-800/80">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => handleLink('home')}
          className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer hover:text-[#E5C158] transition-colors"
        >
          Sufiyan Academy
        </button>

        {/* Zone 2: Concise Single-Line Navigation Links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-zinc-400">
          <button
            type="button"
            onClick={() => handleLink('home')}
            className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              currentView === 'home' ? 'text-white' : 'hover:text-white'
            }`}
          >
            Course
          </button>
          <button
            type="button"
            onClick={() => handleLink('home', 'benefits')}
            className="hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Benefits
          </button>
          <button
            type="button"
            onClick={() => handleLink('track')}
            className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              currentView === 'track' ? 'text-[#E5C158]' : 'hover:text-white'
            }`}
          >
            Track Access
          </button>
          <button
            type="button"
            onClick={() => handleLink('home', 'faq')}
            className="hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            FAQ
          </button>
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center gap-3 shrink-0">
          {currentView === 'admin' ? (
            <button
              type="button"
              onClick={() => handleLink('home')}
              className="hidden sm:inline-flex items-center justify-center px-5 py-2.5 text-xs font-bold tracking-wide text-zinc-200 border border-zinc-700 rounded-lg hover:border-zinc-500 hover:text-white transition-all whitespace-nowrap shrink-0 cursor-pointer"
            >
              View Storefront
            </button>
          ) : (
            <button
              type="button"
              disabled={!isAvailable}
              onClick={() => handleLink('checkout')}
              className="hidden sm:inline-flex items-center justify-center px-5 py-2.5 text-xs font-bold tracking-wide text-[#09090B] bg-gradient-to-r from-[#D4AF37] to-[#F3D578] rounded-lg hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed transition-all whitespace-nowrap shrink-0 cursor-pointer tabular-nums"
            >
              {isAvailable ? `Buy Now · ₹${coursePrice}` : 'Enrollment Paused'}
            </button>
          )}

          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileOpen}
            className="md:hidden p-2.5 rounded-lg text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Responsive Mobile Navigation Drawer */}
      {mobileOpen && (
        <div className="md:hidden border-t border-zinc-800 bg-[#09090B] px-4 py-4 space-y-2">
          <button
            type="button"
            onClick={() => handleLink('home')}
            className="w-full text-left px-3 py-2.5 text-sm font-medium text-zinc-300 hover:text-white hover:bg-zinc-900 rounded-lg"
          >
            Course Overview
          </button>
          <button
            type="button"
            onClick={() => handleLink('home', 'benefits')}
            className="w-full text-left px-3 py-2.5 text-sm font-medium text-zinc-300 hover:text-white hover:bg-zinc-900 rounded-lg"
          >
            Course Benefits
          </button>
          <button
            type="button"
            onClick={() => handleLink('track')}
            className="w-full text-left px-3 py-2.5 text-sm font-medium text-[#E5C158] hover:bg-zinc-900 rounded-lg"
          >
            Already Paid? Track Access
          </button>
          <button
            type="button"
            onClick={() => handleLink('home', 'faq')}
            className="w-full text-left px-3 py-2.5 text-sm font-medium text-zinc-300 hover:text-white hover:bg-zinc-900 rounded-lg"
          >
            FAQ
          </button>
          <div className="pt-2">
            <button
              type="button"
              disabled={!isAvailable}
              onClick={() => handleLink('checkout')}
              className="w-full py-3 text-sm font-bold text-[#09090B] bg-gradient-to-r from-[#D4AF37] to-[#F3D578] rounded-lg disabled:opacity-50 tabular-nums"
            >
              {isAvailable ? `Buy Now · ₹${coursePrice}` : 'Enrollment Paused'}
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
