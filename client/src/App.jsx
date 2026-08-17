import { lazy, Suspense, useEffect, useState } from 'react';
import {
    BrowserRouter as Router,
    Routes,
    Route,
    Link,
    Navigate,
    useLocation,
} from 'react-router-dom';
import { LayoutDashboard, MapPin, LogOut, Users, SlidersHorizontal } from 'lucide-react';
import { showConfirmAlert, showSuccessAlert } from './utils/alerts';

import Login from './pages/Login';

// โหลดหน้าหลังบ้านเมื่อเปิด route นั้นจริง เพื่อลด JavaScript ชุดแรกที่หน้า Login ต้องดาวน์โหลด
const UsageAnalytics = lazy(() => import('./pages/UsageAnalytics'));
const Destinations = lazy(() => import('./pages/Destinations'));
const ReadDestination = lazy(() => import('./pages/ReadDestination'));
const AddDestination = lazy(() => import('./pages/AddDestination'));
const EditDestination = lazy(() => import('./pages/EditDestination'));
const UserManager = lazy(() => import('./pages/UserManager'));
const PlanOptions = lazy(() => import('./pages/PlanOptions'));

const RouteFallback = () => (
    <div className="flex min-h-screen items-center justify-center bg-[#1a1a2e] text-sm text-gray-400">
        กำลังโหลดหน้าจัดการ...
    </div>
);


// คอมโพเนนต์แถบด้านข้าง
const Sidebar = ({ onLogout }) => {
    const location = useLocation();

    const navItems = [
        { label: 'สถิติ', path: '/', icon: LayoutDashboard },
        { label: 'สถานที่', path: '/destinations', icon: MapPin },
        { label: 'ตัวเลือกแผน', path: '/plan-options', icon: SlidersHorizontal },
        { label: 'ผู้ใช้งาน', path: '/users', icon: Users },
    ];

    return (
        <aside
            className="flex w-16 shrink-0 flex-col sm:w-52"
            style={{ background: '#0f1728', height: '100vh', overflow: 'hidden' }}
        >
            <div className="px-3 py-6 text-center sm:px-5 sm:text-left">
                <h1 className="text-base font-bold sm:text-lg" style={{ color: '#f0a500' }}>
                    <span className="sm:hidden">AW</span>
                    <span className="hidden sm:inline">Admin Wave</span>
                </h1>
            </div>

            <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
                {navItems.map((item) => {
                    const isActive =
                        item.path === '/'
                            ? location.pathname === '/'
                            : location.pathname.startsWith(item.path);

                    return (
                        <Link
                            key={item.path}
                            to={item.path}
                            aria-label={item.label}
                            className={`flex items-center justify-center gap-3 rounded-lg px-2 py-3 text-sm transition-all sm:justify-start sm:px-4 ${
                                isActive
                                    ? 'text-white'
                                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                            }`}
                            style={
                                isActive
                                    ? {
                                          background: 'rgba(240,165,0,0.15)',
                                          color: '#f0a500',
                                      }
                                    : {}
                            }
                        >
                            <item.icon size={18} />
                            <span className="hidden sm:inline">{item.label}</span>
                        </Link>
                    );
                })}
            </nav>

            <div className="px-3 pb-6 flex-shrink-0">
                <button
                    onClick={onLogout}
                    aria-label="ออกจากระบบ"
                    className="flex w-full items-center justify-center gap-3 rounded-lg px-2 py-3 text-sm text-gray-400 transition hover:bg-white/5 hover:text-white sm:justify-start sm:px-4"
                >
                    <LogOut size={18} />
                    <span className="hidden sm:inline">ออกจากระบบ</span>
                </button>
            </div>
        </aside>
    );
};


// เลย์เอาต์ที่ต้องยืนยันตัวตน
const ProtectedLayout = ({ onLogout }) => {
    return (
        <div className="flex h-screen" style={{ background: '#1a1a2e' }}>
            <Sidebar onLogout={onLogout} />
            <main
                className="min-w-0 flex-1 overflow-y-auto"
                style={{ background: '#1a1a2e', height: '100vh' }}
            >
                <Routes>
                    <Route path="/" element={<UsageAnalytics />} />
                    <Route path="/destinations" element={<Destinations />} />
                    <Route
                        path="/destinations/read-tat/:id"
                        element={<ReadDestination />}
                    />
                    <Route
                        path="/destinations/add"
                        element={<AddDestination />}
                    />
                    <Route
                        path="/destinations/edit/:id"
                        element={<EditDestination />}
                    />
                    <Route path="/users" element={<UserManager />} />
                    <Route path="/plan-options" element={<PlanOptions />} />
                    <Route path="*" element={<Navigate to="/" />} />
                </Routes>
            </main>
        </div>
    );
};


function App() {
    const [admin, setAdmin] = useState(null);

    useEffect(() => {
        const stored = localStorage.getItem('admin');
        const token = localStorage.getItem('adminToken');

        if (!stored || !token) {
            localStorage.removeItem('admin');
            localStorage.removeItem('adminToken');
            return;
        }

        if (stored) {
            try {
                setAdmin(JSON.parse(stored));
            } catch {
                localStorage.removeItem('admin');
                localStorage.removeItem('adminToken');
            }
        }
    }, []);

    const handleLogin = (adminData) => {
        localStorage.setItem('admin', JSON.stringify(adminData));
        setAdmin(adminData);
    };

    const handleLogout = async () => {
        const result = await showConfirmAlert({
            title: 'ยืนยันการออกจากระบบ',
            text: 'คุณต้องการออกจากระบบใช่หรือไม่?',
            confirmButtonText: 'ออกจากระบบ',
            cancelButtonText: 'ยกเลิก',
            icon: 'question'
        });

        if (result.isConfirmed) {
            localStorage.removeItem('admin');
            localStorage.removeItem('adminToken');
            setAdmin(null);
            showSuccessAlert('ออกจากระบบสำเร็จ');
        }
    };

    return (
        <Router>
            <Suspense fallback={<RouteFallback />}>
                {admin ? (
                    <ProtectedLayout onLogout={handleLogout} />
                ) : (
                    <Routes>
                        <Route path="*" element={<Login onLogin={handleLogin} />} />
                    </Routes>
                )}
            </Suspense>
        </Router>
    );
}

export default App;
