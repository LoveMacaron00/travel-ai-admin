import { useEffect, useState } from 'react';
import { Users, Clock, Download } from 'lucide-react';
import api from '../utils/api';

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
                    topDestinations: [
                        { name: "Phuket Beach", percent: 85, color: "#10B981" },
                        { name: "Chiang Mai Old Town", percent: 72, color: "#3B82F6" },
                        { name: "Bangkok Night Market", percent: 64, color: "#F59E0B" },
                        { name: "Krabi Island", percent: 48, color: "#EF4444" }
                    ]
                });
            }
        };
        fetchStats();
    }, []);

    if (!stats) {
        return (
            <div className="p-6 flex items-center justify-center h-full">
                <div className="text-gray-400">กำลังโหลด...</div>
            </div>
        );
    }

    return (
        <div className="p-6">

            {/* ================= HEADER ================= */}
            <div className="flex justify-between items-start mb-6">
                <div>
                    <p className="text-sm text-gray-500">Home &gt; Statistics Overview</p>
                    <h1 className="text-2xl font-bold text-yellow-400">
                        Statistics Overview
                    </h1>
                    <p className="text-gray-400 text-sm mt-1">
                        Real-time insights for tourist destinations
                    </p>
                </div>
                <button className="btn-gold flex items-center gap-2">
                    <Download size={18} />
                    Export Report
                </button>
            </div>

            {/* ================= STAT CARDS ================= */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">

                {/* Monthly Active Users */}
                <div className="card">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 rounded-lg bg-blue-500/20">
                            <Users size={22} className="text-blue-400" />
                        </div>
                        <span className="badge badge-tat">+12%</span>
                    </div>
                    <p className="text-sm text-gray-400">Monthly Active Users</p>
                    <p className="text-3xl font-bold mt-1">
                        {stats.monthlyActiveUsers.toLocaleString()}
                    </p>
                </div>

                {/* Peak Usage */}
                <div className="card">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 rounded-lg bg-yellow-500/20">
                            <Clock size={22} className="text-yellow-400" />
                        </div>
                    </div>
                    <p className="text-sm text-gray-400">Peak Usage Time</p>
                    <p className="text-3xl font-bold mt-1">
                        {stats.peakUsageTime}
                    </p>
                </div>
            </div>

            {/* ================= TRAFFIC + TOP DEST ================= */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* ===== Traffic Trends ===== */}
                <div className="card lg:col-span-2">
                    <div className="flex justify-between items-center mb-4">
                        <div>
                            <h2 className="text-lg font-semibold">
                                Traffic Trends
                            </h2>
                            <div className="flex items-baseline gap-2 mt-1">
                                <span className="text-3xl font-bold">
                                    {(stats.visits / 1000).toFixed(0)}k
                                </span>
                                <span className="text-sm text-gray-400">
                                    Visits
                                </span>
                                <span className="text-sm text-green-400">
                                    +{stats.visitGrowth}% vs last month
                                </span>
                            </div>
                        </div>

                        <div className="flex gap-1 text-sm">
                            {['30 Days', '7 Days', '24 Hours'].map((label) => (
                                <button
                                    key={label}
                                    onClick={() => setTimeRange(label)}
                                    className={`px-3 py-1 rounded-lg transition ${
                                        timeRange === label
                                            ? 'bg-gray-600 text-white'
                                            : 'text-gray-400 hover:text-white'
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* ===== Fake Chart (Bar + Line) ===== */}
                    <div className="relative h-56 mt-6">

                        {/* SVG Line */}
                        <svg
                            className="absolute inset-0 w-full h-full"
                            viewBox="0 0 100 100"
                            preserveAspectRatio="none"
                        >
                            <polyline
                                fill="none"
                                stroke="#10B981"
                                strokeWidth="2"
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
                        <div className="absolute inset-0 flex items-end gap-1">
                            {stats.trafficData.map((item, i) => (
                                <div
                                    key={i}
                                    className="flex-1 flex flex-col items-center gap-1"
                                >
                                    <div
                                        className="w-full rounded-t transition-all duration-500"
                                        style={{
                                            height: `${(item.value / 500) * 100}%`,
                                            background:
                                                'linear-gradient(to top, rgba(16,185,129,0.2), rgba(16,185,129,0.7))',
                                            minHeight: '6px'
                                        }}
                                    />
                                    <span className="text-[10px] text-gray-500">
                                        {i + 1}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* ===== Top Destinations ===== */}
                <div className="card">
                    <h2 className="text-lg font-semibold mb-4">
                        Top Destinations
                    </h2>
                    <div className="space-y-4">
                        {stats.topDestinations.map((dest, i) => (
                            <div key={i} className="flex items-center gap-3">
                                <div
                                    className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                                    style={{
                                        background: dest.color + '33',
                                        color: dest.color
                                    }}
                                >
                                    {i + 1}
                                </div>

                                <div className="flex-1">
                                    <p className="text-sm font-medium">
                                        {dest.name}
                                    </p>
                                    <div className="w-full h-2 rounded-full bg-gray-700 mt-1">
                                        <div
                                            className="h-full rounded-full transition-all duration-500"
                                            style={{
                                                width: `${dest.percent}%`,
                                                background: dest.color
                                            }}
                                        />
                                    </div>
                                </div>

                                <span className="text-sm font-semibold">
                                    {dest.percent}%
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

            </div>
        </div>
    );
};

export default Dashboard;