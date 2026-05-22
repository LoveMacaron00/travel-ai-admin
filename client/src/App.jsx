import { useState, useEffect } from 'react';
import {
    BrowserRouter as Router,
    Routes,
    Route,
    Link,
    Navigate,
    useLocation,
} from 'react-router-dom';
import { LayoutDashboard, MapPin, LogOut, Users } from 'lucide-react';
import { showConfirmAlert, showSuccessAlert } from './utils/alerts';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Destinations from './pages/Destinations';
import ReadDestination from './pages/ReadDestination';
import AddDestination from './pages/AddDestination';
import EditDestination from './pages/EditDestination';
import UserManager from './pages/UserManager';


// Sidebar Component
const Sidebar = ({ onLogout }) => {
    const location = useLocation();

    const navItems = [
        { label: 'Statistics', path: '/', icon: LayoutDashboard },
        { label: 'Destinations', path: '/destinations', icon: MapPin },
        { label: 'Users', path: '/users', icon: Users },
    ];

    return (
        <aside
            className="w-52 shrink-0 flex flex-col"
            style={{ background: '#0f1728', height: '100vh', overflow: 'hidden' }}
        >
            <div className="px-5 py-6">
                <h1 className="text-lg font-bold" style={{ color: '#f0a500' }}>
                    Admin Wave
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
                            className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-all ${
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
                            <span>{item.label}</span>
                        </Link>
                    );
                })}
            </nav>

            <div className="px-3 pb-6 flex-shrink-0">
                <button
                    onClick={onLogout}
                    className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 transition w-full"
                >
                    <LogOut size={18} />
                    <span>Log Out</span>
                </button>
            </div>
        </aside>
    );
};


// Protected Layout
const ProtectedLayout = ({ onLogout }) => {
    return (
        <div className="flex h-screen" style={{ background: '#1a1a2e' }}>
            <Sidebar onLogout={onLogout} />
            <main
                className="flex-1 overflow-y-auto"
                style={{ background: '#1a1a2e', height: '100vh' }}
            >
                <Routes>
                    <Route path="/" element={<Dashboard />} />
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
            {admin ? (
                <ProtectedLayout onLogout={handleLogout} />
            ) : (
                <Routes>
                    <Route path="*" element={<Login onLogin={handleLogin} />} />
                </Routes>
            )}
        </Router>
    );
}

export default App;
