import { useEffect, useState } from 'react';
import { Users, Clock, Download, TrendingUp, Activity, BarChart3, ArrowUpRight, Eye, MapPin } from 'lucide-react';
import api from '../utils/api';
import AuthenticatedImage from '../components/AuthenticatedImage';

const Dashboard = () => {
    const [stats, setStats] = useState(null);
    const [timeRange, setTimeRange] = useState('30 Days');

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const res = await api.get('/analytics/overview');
                setStats(res.data);
            } catch (err) {
                console.error('เกิดข้อผิดพลาดในการโหลดข้อมูล:', err);
                // Fallback to mock data on error
                const generateTraffic = (days) => {
                    return Array.from({ length: days }, (_, i) => ({
                        date: `Day ${i + 1}`,
                        value: 100 + i * 8 + Math.random() * 80
                    }));
                };
                setStats({
                    monthlyActiveUsers: 98432,
                    peakUsageTime: "19:00 - 21:00",
                    visits: 158420,
                    visitGrowth: 18,
                    trafficData: generateTraffic(30),
                    topDestinations: []
                });
            }
        };
        fetchStats();
    }, []);

    if (!stats) {
        return (
            <div className="p-6 flex items-center justify-center h-[60vh]">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-yellow-500/20 border-t-yellow-500 rounded-full"></div>
                    <div className="text-gray-400 font-medium">กำลังโหลดข้อมูลเชิงสถิติ...</div>
                </div>
            </div>
        );
    }

    return (
        <div className="p-3 md:p-4 w-full space-y-3 md:space-y-4">

            {/* ================= HEADER ================= */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 bg-gradient-to-r from-gray-900 to-gray-800 p-4 rounded-xl border border-gray-800 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
                <div className="absolute bottom-0 left-10 w-40 h-40 bg-blue-500/5 rounded-full blur-2xl -mb-10 pointer-events-none" />

                <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-3">
                        <span className="px-3 py-1 rounded-full bg-yellow-500/10 text-yellow-500 text-xs font-bold tracking-widest uppercase">Analytics</span>
                    </div>
                    <h1 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
                        Statistics Overview
                    </h1>
                    <p className="text-gray-400 mt-2 text-base max-w-xl leading-relaxed">
                        Real-time insights and performance metrics for tourist destinations.
                    </p>
                </div>
                
                <button className="relative z-10 flex items-center justify-center gap-1.5 px-4 py-2 bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-400 hover:to-yellow-500 text-black font-bold rounded-lg shadow-[0_0_15px_rgba(234,179,8,0.3)] hover:shadow-[0_0_25px_rgba(234,179,8,0.5)] text-xs">
                    <Download size={16} />
                    Export Report
                </button>
            </div>

            {/* ================= STAT CARDS ================= */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">

                {/* Monthly Active Users */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 md:p-4 shadow-xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-[0.03]">
                        <Users size={40} className="text-blue-500" />
                    </div>
                    <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20 shadow-[0_0_20px_rgba(59,130,246,0.1)]">
                                <Users size={16} />
                            </div>
                        </div>
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs font-bold border border-emerald-500/20">
                            <ArrowUpRight size={14} />
                            +12%
                        </span>
                    </div>
                    <p className="font-semibold text-gray-400 mb-1 text-sm">Monthly Active Users</p>
                    <p className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
                        {stats.monthlyActiveUsers.toLocaleString()}
                    </p>
                </div>

                {/* Peak Usage */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 md:p-4 shadow-xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-[0.03]">
                        <Clock size={40} className="text-yellow-500" />
                    </div>
                    <div className="flex items-center gap-3 mb-3">
                        <div className="p-2.5 rounded-lg bg-yellow-500/10 text-yellow-400 ring-1 ring-yellow-500/20 shadow-[0_0_20px_rgba(234,179,8,0.1)]">
                            <Clock size={16} />
                        </div>
                    </div>
                    <p className="font-semibold text-gray-400 mb-1 text-sm">Peak Usage Time</p>
                    <p className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
                        {stats.peakUsageTime}
                    </p>
                </div>

                {/* Total Visits Summary */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 md:p-4 shadow-xl relative overflow-hidden md:col-span-2 lg:col-span-1">
                    <div className="absolute top-0 right-0 p-4 opacity-[0.03]">
                        <Activity size={40} className="text-emerald-500" />
                    </div>
                    <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.1)]">
                                <Activity size={16} />
                            </div>
                        </div>
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs font-bold border border-emerald-500/20">
                            <ArrowUpRight size={14} />
                            +{stats.visitGrowth}%
                        </span>
                    </div>
                    <p className="font-semibold text-gray-400 mb-1 text-sm">Total Visits</p>
                    <p className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
                        {(stats.visits / 1000).toFixed(1)}k
                    </p>
                </div>
            </div>

            {/* ================= TRAFFIC + TOP DEST ================= */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-4">

                {/* ===== Traffic Trends ===== */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-xl overflow-hidden lg:col-span-2 flex flex-col">
                    <div className="p-3 md:p-4 border-b border-gray-800 bg-gray-900/80 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                        <div>
                            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                <TrendingUp size={20} className="text-emerald-500" />
                                Traffic Trends
                            </h2>
                            <p className="text-sm text-gray-500 mt-1">Platform engagement over time</p>
                        </div>

                        <div className="flex bg-black/40 p-1 rounded-xl border border-gray-800">
                            {['30 Days', '7 Days', '24 Hours'].map((label) => (
                                <button
                                    key={label}
                                    onClick={() => setTimeRange(label)}
                                    className={`px-4 py-1.5 rounded-lg text-sm font-semibold ${
                                        timeRange === label
                                            ? 'bg-gray-800 text-white shadow-sm'
                                            : 'text-gray-500 hover:text-white'
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="p-3 md:p-4 flex-1 flex flex-col">
                        {/* ===== Fake Chart (Bar + Line) ===== */}
                        <div className="relative h-48 mt-2 flex-1">
                            {/* Background Grid Lines */}
                            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-20">
                                {[1, 2, 3, 4, 5].map(i => (
                                    <div key={i} className="w-full h-px bg-gray-600 border-dashed border-t border-gray-600" />
                                ))}
                            </div>

                            {/* SVG Line */}
                            <svg
                                className="absolute inset-0 w-full h-full z-10 drop-shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                                viewBox="0 0 100 100"
                                preserveAspectRatio="none"
                            >
                                <polyline
                                    fill="none"
                                    stroke="#10B981"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    points={stats.trafficData
                                        .map((item, i) => {
                                            const x = (i / (stats.trafficData.length - 1)) * 100;
                                            const y = 100 - (item.value / 500) * 100;
                                            return `${x},${y}`;
                                        })
                                        .join(" ")}
                                />
                            </svg>

                            {/* Bars */}
                            <div className="absolute inset-0 flex items-end gap-1.5 sm:gap-2 px-1">
                                {stats.trafficData.map((item, i) => (
                                    <div
                                        key={i}
                                        className="flex-1 flex flex-col items-center gap-2 relative"
                                    >
                                        {/* Tooltip on hover */}
                                        <div className="absolute -top-10 opacity-0 bg-gray-800 text-white text-[10px] font-bold px-2 py-1 rounded pointer-events-none z-20 whitespace-nowrap shadow-xl border border-gray-700">
                                            {Math.round(item.value)} visits
                                        </div>
                                        
                                        <div
                                            className="w-full rounded-t-sm"
                                            style={{
                                                height: `${(item.value / 500) * 100}%`,
                                                background: 'linear-gradient(to top, rgba(16,185,129,0.1) 0%, rgba(16,185,129,0.6) 100%)',
                                                minHeight: '4px'
                                            }}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="flex justify-between mt-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            <span>{stats.trafficData[0].date}</span>
                            <span>{stats.trafficData[stats.trafficData.length - 1].date}</span>
                        </div>
                    </div>
                </div>

                {/* ===== Top Destinations ===== */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-xl overflow-hidden flex flex-col">
                    <div className="p-3 md:p-4 border-b border-gray-800 bg-gray-900/80">
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <BarChart3 size={20} className="text-blue-500" />
                            Top Destinations
                        </h2>
                        <p className="text-sm text-gray-500 mt-1">Most visited places</p>
                    </div>
                    
                    <div className="p-3 md:p-4 space-y-2 flex-1">
                        {stats.topDestinations.length > 0 ? (
                            stats.topDestinations.map((dest, i) => (
                                <div
                                    key={dest.id || i}
                                    className="flex items-center gap-4 rounded-2xl p-2 -mx-2"
                                >
                                    <div className="relative w-16 h-12 rounded-xl overflow-hidden bg-gray-800 shrink-0 border border-gray-800">
                                        <AuthenticatedImage
                                            src={dest.image}
                                            alt={dest.name}
                                            loading="lazy"
                                            decoding="async"
                                            className="w-full h-full object-cover"
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                                        <span className="absolute left-2 bottom-1.5 px-1.5 py-0.5 rounded-md bg-black/70 text-white text-[10px] font-bold">
                                            #{i + 1}
                                        </span>
                                    </div>

                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-bold text-gray-100 truncate">
                                            {dest.name}
                                        </p>
                                        <p className="mt-1 text-xs text-gray-500 flex items-center gap-1 min-w-0">
                                            <MapPin size={12} className="shrink-0" />
                                            <span className="truncate">{dest.location || dest.city || 'Thailand'}</span>
                                        </p>
                                        <div className="mt-2 flex items-center gap-2">
                                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-300 bg-white/5 border border-white/5 px-2 py-1 rounded-lg">
                                                <Eye size={12} className="text-gray-500" />
                                                {Number(dest.viewer || 0).toLocaleString()}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="h-full min-h-48 flex flex-col items-center justify-center text-center px-6">
                                <BarChart3 size={36} className="text-gray-700 mb-3" />
                                <p className="text-sm font-semibold text-gray-400">No Destinations found</p>
                                <p className="text-xs text-gray-600 mt-1">Please add destinations to see rankings.</p>
                            </div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
};

export default Dashboard;
