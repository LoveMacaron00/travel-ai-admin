import { useCallback, useEffect, useRef, useState } from 'react';
import {
    Activity,
    BarChart3,
    CalendarDays,
    Clock3,
    Download,
    MapPin,
    RefreshCw,
    Timer,
    TrendingUp,
    Users,
} from 'lucide-react';
import AuthenticatedImage from '../components/AuthenticatedImage';
import MetricCard from '../components/dashboard/MetricCard';
import UsageTrendChart from '../components/dashboard/UsageTrendChart';
import api from '../utils/api';
import {
    analyticsRanges,
    buildAnalyticsCsv,
    formatDuration,
    formatPeriodLabel,
    formatUpdatedAt,
    normalizeAnalyticsPayload,
    normalizeDestinationTrendPayload,
} from '../utils/dashboardAnalytics';

const UsageAnalytics = () => {
    const [stats, setStats] = useState(null);
    const [range, setRange] = useState('30d');
    const [refreshKey, setRefreshKey] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState('');
    const [selectedDestination, setSelectedDestination] = useState(null);
    const [destinationTrend, setDestinationTrend] = useState(null);
    const [destinationTrendLoading, setDestinationTrendLoading] = useState(false);
    const [destinationTrendError, setDestinationTrendError] = useState('');
    const destinationTrendRequest = useRef(0);

    useEffect(() => {
        const controller = new AbortController();

        const fetchStats = async () => {
            setIsLoading(true);
            setIsRefreshing(true);
            setError('');

            try {
                const response = await api.get('/analytics/overview', {
                    params: { range },
                    signal: controller.signal,
                });
                setStats(normalizeAnalyticsPayload(response.data));
            } catch (requestError) {
                if (requestError.code !== 'ERR_CANCELED') {
                    setError(
                        requestError.response?.data?.message
                        || requestError.message
                        || 'ไม่สามารถโหลดข้อมูลสถิติได้',
                    );
                }
            } finally {
                if (!controller.signal.aborted) {
                    setIsLoading(false);
                    setIsRefreshing(false);
                }
            }
        };

        fetchStats();
        return () => controller.abort();
    }, [range, refreshKey]);

    const refresh = useCallback(() => {
        destinationTrendRequest.current += 1;
        setSelectedDestination(null);
        setDestinationTrend(null);
        setDestinationTrendError('');
        setDestinationTrendLoading(false);
        setRefreshKey((value) => value + 1);
    }, []);

    const changeRange = (nextRange) => {
        destinationTrendRequest.current += 1;
        setSelectedDestination(null);
        setDestinationTrend(null);
        setDestinationTrendError('');
        setDestinationTrendLoading(false);
        setRange(nextRange);
    };

    const selectDestination = async (destination) => {
        if (selectedDestination?.id === destination.id) {
            destinationTrendRequest.current += 1;
            setSelectedDestination(null);
            setDestinationTrend(null);
            setDestinationTrendError('');
            setDestinationTrendLoading(false);
            return;
        }

        const requestId = destinationTrendRequest.current + 1;
        destinationTrendRequest.current = requestId;
        setSelectedDestination(destination);
        setDestinationTrend(null);
        setDestinationTrendError('');
        setDestinationTrendLoading(true);

        try {
            const response = await api.get(`/analytics/destinations/${destination.id}/trend`, {
                params: { range },
            });
            if (destinationTrendRequest.current === requestId) {
                setDestinationTrend(normalizeDestinationTrendPayload(response.data));
            }
        } catch (requestError) {
            if (destinationTrendRequest.current === requestId) {
                setDestinationTrendError(
                    requestError.response?.data?.message
                    || requestError.message
                    || 'ไม่สามารถโหลดแนวโน้มของสถานที่ได้',
                );
            }
        } finally {
            if (destinationTrendRequest.current === requestId) {
                setDestinationTrendLoading(false);
            }
        }
    };

    const exportReport = () => {
        if (!stats) return;
        const csv = buildAnalyticsCsv(stats);
        const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `gothai-analytics-${stats.period}-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
    };

    if (isLoading && !stats) {
        return (
            <div className="flex h-[60vh] items-center justify-center p-6" role="status">
                <div className="flex flex-col items-center gap-4">
                    <div className="h-12 w-12 animate-spin rounded-full border-4 border-yellow-500/20 border-t-yellow-500" />
                    <p className="font-medium text-gray-400">กำลังโหลดข้อมูลสถิติ...</p>
                </div>
            </div>
        );
    }

    if (error && !stats) {
        return (
            <div className="flex h-[60vh] items-center justify-center p-6">
                <div className="max-w-md rounded-xl border border-rose-500/20 bg-gray-900 p-6 text-center shadow-xl">
                    <Activity className="mx-auto text-rose-400" size={36} />
                    <h1 className="mt-4 text-lg font-bold text-white">ไม่สามารถแสดงข้อมูลสถิติได้</h1>
                    <p className="mt-2 text-sm text-gray-400">{error}</p>
                    <button
                        type="button"
                        onClick={refresh}
                        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-yellow-500 px-4 py-2 text-sm font-bold text-black hover:bg-yellow-400"
                    >
                        <RefreshCw size={15} />
                        ลองอีกครั้ง
                    </button>
                </div>
            </div>
        );
    }

    const summary = stats.summary;
    const destinationTrendByKey = new Map(
        (destinationTrend ?? []).map((point) => [point.key, point]),
    );
    const chartData = stats.trendData.map((point) => {
        if (!selectedDestination) return point;
        const destinationPoint = destinationTrendByKey.get(point.key);
        return {
            ...point,
            destinationViews: destinationPoint?.views ?? 0,
            uniqueDestinationViewers: destinationPoint?.uniqueViewers ?? 0,
        };
    });
    const periodLabel = formatPeriodLabel(stats.periodLabel);
    const viewLabel = selectedDestination
        ? `ยอดดู ${selectedDestination.name}`
        : 'ยอดดูสถานที่';

    return (
        <main className="w-full space-y-4 p-3 md:p-4">
            <section className="relative overflow-hidden rounded-xl border border-gray-800 bg-gradient-to-r from-gray-900 to-gray-800 p-4 shadow-xl">
                <div className="pointer-events-none absolute -mr-20 -mt-20 right-0 top-0 h-64 w-64 rounded-full bg-yellow-500/10 blur-3xl" />
                <div className="relative z-10 flex flex-col justify-between gap-4 md:flex-row md:items-end">
                    <div>
                        <h1 className="text-xl font-extrabold tracking-tight text-white md:text-2xl">สถิติการใช้งาน</h1>
                        <p className="mt-2 max-w-xl text-sm leading-relaxed text-gray-400">
                            ข้อมูลผู้ใช้แบบเรียลไทม์ กิจกรรมรายเดือน และแนวโน้มการใช้งานจากแอป GoThai
                        </p>
                        <p className="mt-2 text-xs text-gray-500">
                            อัปเดตล่าสุด {formatUpdatedAt(stats.generatedAt, stats.timeZone)} · {stats.timeZone}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={refresh}
                            disabled={isRefreshing}
                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-700 bg-gray-900/70 px-3 py-2 text-xs font-bold text-gray-200 hover:border-gray-600 hover:bg-gray-800 disabled:cursor-wait disabled:opacity-60"
                        >
                            <RefreshCw className={isRefreshing ? 'animate-spin' : ''} size={15} />
                            รีเฟรช
                        </button>
                        <button
                            type="button"
                            onClick={exportReport}
                            className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-yellow-500 to-yellow-600 px-4 py-2 text-xs font-bold text-black shadow-[0_0_15px_rgba(234,179,8,0.3)] hover:from-yellow-400 hover:to-yellow-500"
                        >
                            <Download size={15} />
                            ส่งออก CSV
                        </button>
                    </div>
                </div>
            </section>

            {error && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                    <span>{error} กำลังแสดงข้อมูลล่าสุดที่โหลดสำเร็จ</span>
                    <button type="button" className="font-bold underline" onClick={refresh}>ลองอีกครั้ง</button>
                </div>
            )}

            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="สรุปการใช้งาน">
                <MetricCard
                    icon={Activity}
                    label="ผู้ใช้ที่ใช้งานขณะนี้"
                    value={summary.activeUsersNow.toLocaleString()}
                    detail={`ผู้ใช้ลงทะเบียนทั้งหมด ${summary.totalRegisteredUsers.toLocaleString()} คน`}
                    tone="emerald"
                />
                <MetricCard
                    icon={Users}
                    label="ผู้ใช้ที่ใช้งานรายเดือน"
                    value={summary.monthlyActiveUsers.toLocaleString()}
                    detail={summary.monthlyUserGrowth == null ? 'เดือนแรกที่มีการบันทึกกิจกรรม' : 'เปรียบเทียบกับเดือนก่อนหน้า'}
                    tone="blue"
                    growth={summary.monthlyUserGrowth}
                />
                <MetricCard
                    icon={Timer}
                    label="ระยะเวลาใช้งานเฉลี่ย"
                    value={formatDuration(summary.averageSessionSeconds)}
                    detail={`${summary.totalSessions.toLocaleString()} เซสชัน ในช่วง ${periodLabel}`}
                    tone="violet"
                />
                <MetricCard
                    icon={Clock3}
                    label="ช่วงเวลาที่มีผู้ใช้สูงสุด"
                    value={summary.peakUsageTime || 'ยังไม่มีข้อมูล'}
                    detail={`ช่วงเริ่มเซสชันสูงสุดภายใน ${periodLabel}`}
                    tone="amber"
                />
            </section>

            <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900 shadow-xl lg:col-span-2">
                    <div className="flex flex-col items-start justify-between gap-3 border-b border-gray-800 p-4 sm:flex-row sm:items-center">
                        <div>
                            <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                                <TrendingUp className="text-emerald-500" size={20} />
                                การใช้งานและยอดดูสถานที่
                            </h2>
                            <p className="mt-1 text-sm text-gray-500">
                                {selectedDestination
                                    ? `แนวโน้มความนิยมของ ${selectedDestination.name}`
                                    : 'ผู้ใช้ที่ใช้งานและยอดดูรายละเอียดสถานที่ทั้งหมด'}
                            </p>
                            {selectedDestination && (
                                <button
                                    type="button"
                                    onClick={() => selectDestination(selectedDestination)}
                                    className="mt-2 text-xs font-semibold text-amber-400 hover:text-amber-300"
                                >
                                    ล้างตัวกรองสถานที่
                                </button>
                            )}
                        </div>
                        <div className="flex flex-wrap rounded-lg border border-gray-800 bg-black/40 p-1" aria-label="ช่วงเวลาของกราฟ">
                            {analyticsRanges.map((option) => (
                                <button
                                    type="button"
                                    key={option.key}
                                    aria-pressed={range === option.key}
                                    onClick={() => changeRange(option.key)}
                                    className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                                        range === option.key
                                            ? 'bg-gray-800 text-white shadow-sm'
                                            : 'text-gray-500 hover:text-white'
                                    }`}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className={`p-4 transition-opacity ${isRefreshing || destinationTrendLoading ? 'opacity-50' : 'opacity-100'}`}>
                        <UsageTrendChart data={chartData} viewLabel={viewLabel} />
                        <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-gray-500">
                            <span className="inline-flex items-center gap-2">
                                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                                ผู้ใช้ที่ใช้งาน
                            </span>
                            <span className="inline-flex items-center gap-2">
                                <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                                {viewLabel}
                            </span>
                        </div>
                        {destinationTrendError && (
                            <p className="mt-3 text-xs text-rose-400">{destinationTrendError}</p>
                        )}
                    </div>
                </div>

                <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900 shadow-xl">
                    <div className="border-b border-gray-800 p-4">
                        <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                            <BarChart3 className="text-blue-500" size={20} />
                            สถานที่ยอดนิยม
                        </h2>
                        <p className="mt-1 text-sm text-gray-500">
                            จัดอันดับตามยอดดูรายละเอียดในช่วง {periodLabel}
                        </p>
                    </div>
                    <div className="space-y-2 p-4">
                        {stats.topDestinations.length > 0 ? stats.topDestinations.map((destination, index) => (
                            <button
                                type="button"
                                key={destination.id}
                                aria-pressed={selectedDestination?.id === destination.id}
                                onClick={() => selectDestination(destination)}
                                className={`flex w-full items-center gap-3 rounded-xl border p-2 text-left transition ${
                                    selectedDestination?.id === destination.id
                                        ? 'border-amber-500/40 bg-amber-500/10'
                                        : 'border-transparent hover:border-gray-700 hover:bg-white/[0.03]'
                                }`}
                            >
                                <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded-lg border border-gray-800 bg-gray-800">
                                    <AuthenticatedImage
                                        src={destination.image}
                                        alt=""
                                        loading="lazy"
                                        decoding="async"
                                        className="h-full w-full object-cover"
                                    />
                                    <span className="absolute bottom-1 left-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-white">#{index + 1}</span>
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-bold text-gray-100">{destination.name}</p>
                                    <p className="mt-1 flex min-w-0 items-center gap-1 text-xs text-gray-500">
                                        <MapPin className="shrink-0" size={12} />
                                        <span className="truncate">{destination.location}</span>
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm font-bold text-gray-200">{destination.viewer.toLocaleString()}</p>
                                    <p className="text-[10px] text-gray-500">ครั้ง</p>
                                    <p className="mt-0.5 text-[10px] text-gray-600">
                                        ผู้ชมไม่ซ้ำ {destination.uniqueViewers.toLocaleString()} คน
                                    </p>
                                </div>
                            </button>
                        )) : (
                            <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
                                <CalendarDays className="mb-3 text-gray-700" size={36} />
                                <p className="text-sm font-semibold text-gray-400">ยังไม่มีสถานที่</p>
                                <p className="mt-1 text-xs text-gray-600">สถานที่ที่อนุมัติแล้วจะแสดงที่นี่</p>
                            </div>
                        )}
                    </div>
                </div>
            </section>
        </main>
    );
};

export default UsageAnalytics;
