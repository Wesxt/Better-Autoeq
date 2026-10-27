import { createSignal } from 'solid-js';
import { Header } from './components/Header/Header';
import { CurveList } from './components/Sidebar/CurveList';
import { FrequencyPlot } from './components/Chart/FrequencyPlot';
import { AutoEqPanel } from './components/AutoEq/AutoEqPanel';
import { MicModal } from './components/Mic/MicModal';
import { ExportModal } from './components/Export/ExportModal';

export function App() {
  const [isSidebarOpen, setIsSidebarOpen] = createSignal(false);

  return (
    <div class="h-dvh w-screen flex flex-col bg-(--bg-app) text-(--text-main) overflow-hidden select-none font-sans transition-colors">
      {/* Top Header */}
      <Header
        isSidebarOpen={isSidebarOpen()}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen())}
      />

      {/* Main Workspace */}
      <div class="flex-1 flex overflow-hidden relative min-h-0">
        {/* Left Sidebar: Curve Manager & Ingestion (Drawer on mobile/tablet, docked on lg+) */}
        <CurveList
          isOpen={isSidebarOpen()}
          onClose={() => setIsSidebarOpen(false)}
        />

        {/* Central Visualization & Processing Studio */}
        <main class="flex-1 min-w-0 flex flex-col overflow-y-auto lg:overflow-hidden p-1.5 sm:p-2 gap-1.5 sm:gap-2 bg-(--bg-app)">
          {/* Main uPlot Canvas */}
          <div class="flex-1 min-h-[210px] sm:min-h-[250px] lg:min-h-0">
            <FrequencyPlot />
          </div>

          {/* Bottom AutoEq Processing Studio */}
          <AutoEqPanel />
        </main>
      </div>

      {/* Acoustic Measurement & RTA Modal */}
      <MicModal />

      {/* Advanced Export Modal */}
      <ExportModal />
    </div>
  );
}

export default App;
