import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, MapPin, Eye, Tag, ChevronLeft, ChevronRight, Filter, Compass, LayoutGrid, RefreshCw } from 'lucide-react';
import api from '../utils/api';
import { showConfirmAlert, showErrorAlert, showSuccessAlert } from '../utils/alerts';

const PAGE_SIZE = 10;
const DEBOUNCE_MS = 500;

// หมวดหมู่สถานที่ของ TAT API (ส่งค่า `id` เป็น query param `place_category`)
// สำคัญ: TAT API รับเฉพาะ categoryCode ภาษาอังกฤษ — ถ้าส่งชื่อไทย API จะตอบ 500
const PLACE_CATEGORIES = [
    { id: 'all', label: 'ทุกหมวดหมู่' },
    { id: 'attraction', label: 'สถานที่ท่องเที่ยว' },
    { id: 'accommodation', label: 'ที่พัก' },
    { id: 'restaurant', label: 'ร้านอาหาร' },
    { id: 'shop', label: 'ร้านค้า' },
    { id: 'other', label: 'อื่นๆ' }
];

const Destinations = () => {
    const navigate = useNavigate();

    const [adminDests, setAdminDests] = useState([]);
    const [tatDests, setTatDests] = useState([]);
    const [page, setPage] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [loading, setLoading] = useState(false);
    const [syncingId, setSyncingId] = useState(null);
    const [bulkSyncing, setBulkSyncing] = useState(false);

    const [filters, setFilters] = useState({
        source: 'tat',
        status: 'all',
        placeCategory: 'all'
    });

    const abortRef = useRef(null);
    const debounceRef = useRef(null);
    const requestIdRef = useRef(0);

    // -----------------------
    // Helpers
    // -----------------------
    const getFirstImage = (val) => {
        if (!val) return '';
        if (typeof val === 'string') return val;
        if (Array.isArray(val)) return val[0] || '';
        return '';
    };

    const normalizeStatus = (status) => {
        if (!status) return '';
        return String(status).toLowerCase();
    };

    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    const sourceTotalCount = filters.source === 'tat' ? totalItems : adminDests.length;
    const visibleTotalPages = filters.source === 'tat' ? totalPages : 1;
    const visiblePage = filters.source === 'tat' ? page : 1;

    // -----------------------
    // Debounced search
    // -----------------------
    useEffect(() => {
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setDebouncedSearch(search);
        }, DEBOUNCE_MS);
        return () => clearTimeout(debounceRef.current);
    }, [search]);

    // -----------------------
    // Fetch All Data (parallel)
    // -----------------------
    const fetchData = useCallback(async (keyword, pageNum, source, placeCategory) => {
        requestIdRef.current += 1;
        const currentRequestId = requestIdRef.current;

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setLoading(true);

        try {
            if (source === 'admin') {
                const adminParams = new URLSearchParams();
                if (keyword) adminParams.set('search', keyword);

                const adminRes = await api.get(`/destinations?${adminParams}`, {
                    signal: controller.signal
                });

                if (requestIdRef.current !== currentRequestId) {
                    return;
                }

                const adminItems = Array.isArray(adminRes.data) ? adminRes.data : [];
                setAdminDests(adminItems);
                setTatDests([]);
                setTotalItems(adminItems.length);
            } else {
                const tatParams = new URLSearchParams();
                if (keyword) tatParams.set('keyword', keyword);
                if (placeCategory && placeCategory !== 'all') {
                    tatParams.set('place_category', placeCategory);
                }
                tatParams.set('limit', PAGE_SIZE);
                tatParams.set('page', pageNum);

                const tatRes = await api.get(`/v2/places?${tatParams}`, {
                    signal: controller.signal
                });

                if (requestIdRef.current !== currentRequestId) {
                    return;
                }

                const results = tatRes.data?.data || [];
                const pagination = tatRes.data?.pagination || {};
                setTatDests(Array.isArray(results) ? results : []);
                setAdminDests([]);
                setTotalItems(pagination.total || 0);
            }
        } catch (err) {
            if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
                return;
            }

            console.error('เกิดข้อผิดพลาดในการโหลดข้อมูล:', err);
            setAdminDests([]);
            setTatDests([]);
            setTotalItems(0);
        } finally {
            if (requestIdRef.current === currentRequestId) {
                setLoading(false);
                if (abortRef.current === controller) {
                    abortRef.current = null;
                }
            }
        }
    }, []);

    // -----------------------
    // Load Data on search/page change
    // -----------------------
    useEffect(() => {
        setPage(1);
        fetchData(debouncedSearch, 1, filters.source, filters.placeCategory);
    }, [debouncedSearch, filters.source, filters.placeCategory, fetchData]);

    useEffect(() => {
        setPage(1);
    }, [filters.source, filters.placeCategory]);

    useEffect(() => {
        return () => {
            abortRef.current?.abort();
        };
    }, []);

    // -----------------------
    // Search submit
    // -----------------------
    const handleSearch = (e) => {
        e.preventDefault();
        clearTimeout(debounceRef.current);
        setDebouncedSearch(search);
    };

    // -----------------------
    // Pagination
    // -----------------------
    const handlePageChange = (newPage) => {
        if (newPage < 1 || newPage > totalPages) return;
        setPage(newPage);
        fetchData(debouncedSearch, newPage, filters.source, filters.placeCategory);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const getPageNumbers = () => {
        const pages = [];
        const maxVisible = 5;
        let start = Math.max(1, page - Math.floor(maxVisible / 2));
        let end = Math.min(totalPages, start + maxVisible - 1);
        if (end - start + 1 < maxVisible) {
            start = Math.max(1, end - maxVisible + 1);
        }
        for (let i = start; i <= end; i++) pages.push(i);
        return pages;
    };

    // -----------------------
    // Delete Admin Destination
    // -----------------------
    const handleDelete = async (id) => {
        const result = await showConfirmAlert({
            title: 'ลบสถานที่นี้?',
            text: 'ข้อมูลสถานที่จะถูกลบออกจากระบบ',
            confirmButtonText: 'ลบสถานที่',
            cancelButtonText: 'ยกเลิก'
        });

        if (!result.isConfirmed) return;

        try {
            await api.delete(`/destinations/${id}`);
            await showSuccessAlert('ลบสถานที่เรียบร้อยแล้ว');
            fetchData(debouncedSearch, page, filters.source, filters.placeCategory);
        } catch (err) {
            console.error('เกิดข้อผิดพลาดในการลบ:', err);
            await showErrorAlert('ลบสถานที่ไม่สำเร็จ');
        }
    };

    const handleBulkSyncTAT = async () => {
        const activeCategory = filters.placeCategory && filters.placeCategory !== 'all'
            ? PLACE_CATEGORIES.find((c) => c.id === filters.placeCategory)?.label || filters.placeCategory
            : 'ทุกหมวดหมู่';
        const result = await showConfirmAlert({
            title: 'Sync สถานที่จาก TAT API?',
            text: `คุณต้องการเริ่ม Sync สถานที่ทั้งหมด (หมวดหมู่: ${activeCategory}, คำค้น: "${debouncedSearch || 'ทั้งหมด'}") เข้าสู่ระบบและคำนวณ Embedding ใช่หรือไม่? (ใช้เวลาสักครู่ใน Background)`,
            confirmButtonText: 'เริ่ม Sync',
            cancelButtonText: 'ยกเลิก'
        });

        if (!result.isConfirmed) return;

        setBulkSyncing(true);
        try {
            const res = await api.post('/admin/sync/tat', {
                keyword: debouncedSearch,
                placeCategory: filters.placeCategory !== 'all' ? filters.placeCategory : undefined
            });
            await showSuccessAlert(res.data?.message || 'สั่ง Sync ข้อมูลทั้งหมดเรียบร้อยแล้ว (รันใน Background)');
        } catch (err) {
            console.error('เกิดข้อผิดพลาดในการ Bulk Sync:', err);
            await showErrorAlert(err.response?.data?.message || 'สั่ง Sync ข้อมูลไม่สำเร็จ');
        } finally {
            setBulkSyncing(false);
        }
    };

    const handleSingleSyncTAT = async (tatPlaceId, name) => {
        const result = await showConfirmAlert({
            title: 'Sync สถานที่นี้?',
            text: `ต้องการดึงข้อมูล "${name}" เข้าฐานข้อมูลและทำ Embedding ใช่หรือไม่?`,
            confirmButtonText: 'เริ่ม Sync',
            cancelButtonText: 'ยกเลิก'
        });

        if (!result.isConfirmed) return;

        setSyncingId(tatPlaceId);
        try {
            await api.post(`/admin/sync/tat/${tatPlaceId}`);
            await showSuccessAlert(`Sync และทำ Embedding สำหรับ "${name}" สำเร็จแล้ว!`);
        } catch (err) {
            console.error('เกิดข้อผิดพลาดในการ Sync รายบุคคล:', err);
            await showErrorAlert(err.response?.data?.message || 'Sync สถานที่ไม่สำเร็จ');
        } finally {
            setSyncingId(null);
        }
    };

    // -----------------------
    // Combine + Normalize Data
    // -----------------------
    const allItems = useMemo(() => {
        let items = [];

        if (filters.source === 'tat') {
            items.push(
                ...tatDests.map((d) => {
                    const provName = d.location?.province?.name || '';
                    const distName = d.location?.district?.name || '';
                    const locationStr = [distName, provName]
                        .filter(Boolean)
                        .join(', ');

                    const image =
                        getFirstImage(d.thumbnailUrl) ||
                        d.sha?.detailThumbnail ||
                        d.sha?.thumbnailUrl ||
                        '';

                    return {
                        id: d.placeId || d.id || crypto.randomUUID(),
                        name: d.name || 'Unknown',
                        province: locationStr || 'Unknown',
                        image,
                        viewer: d.viewer || 0,
                        tags: d.tags || [],
                        status: normalizeStatus(d.status),
                        introduction: d.introduction || d.sha?.detail || '',
                        category: d.category?.name || '',
                        source: 'tat_api'
                    };
                })
            );
        }

        if (filters.source === 'admin') {
            items.push(
                ...adminDests.map((d) => ({
                    id: d.id,
                    name: d.name,
                    province: d.province || '',
                    image: d.image_url || '',
                    viewer: 0,
                    tags: [],
                    status: normalizeStatus(d.status),
                    source: 'admin'
                }))
            );
        }

        if (filters.status !== 'all') {
            items = items.filter((item) => item.status === filters.status);
        }

        return items;
    }, [tatDests, adminDests, filters]);

    const statusCounts = useMemo(() => {
        const baseItems = [];

        if (filters.source === 'tat') {
            baseItems.push(...tatDests.map((d) => normalizeStatus(d.status)));
        }

        if (filters.source === 'admin') {
            baseItems.push(...adminDests.map((d) => normalizeStatus(d.status)));
        }

        return {
            pending: baseItems.filter((status) => status === 'pending').length,
            approved: baseItems.filter((status) => status === 'approved').length,
            rejected: baseItems.filter((status) => status === 'rejected').length
        };
    }, [tatDests, adminDests, filters.source]);

    // -----------------------
    // UI
    // -----------------------
    return (
        <div className="p-6 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 bg-gradient-to-r from-gray-900 to-gray-800 p-8 rounded-3xl border border-gray-800 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
                <div className="absolute bottom-0 left-10 w-40 h-40 bg-blue-500/5 rounded-full blur-2xl -mb-10 pointer-events-none" />

                <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-3">
                        <span className="px-3 py-1 rounded-full bg-yellow-500/10 text-yellow-500 text-xs font-bold tracking-widest uppercase">Explore</span>
                    </div>
                    <h1 className="text-4xl font-extrabold text-white tracking-tight">
                        Destinations
                    </h1>
                    <p className="text-gray-400 mt-2 text-base max-w-xl leading-relaxed">
                        Manage all travel destinations. Browse places from TAT API or create your own custom locations.
                    </p>
                    {sourceTotalCount > 0 && (
                        <div className="flex items-center gap-2 mt-4">
                            <span className="bg-gray-800 text-gray-300 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-700">
                                Total: {sourceTotalCount.toLocaleString()} places
                            </span>
                            <span className="bg-gray-800/50 text-gray-400 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-700/50">
                                Source: {filters.source === 'tat' ? 'TAT API' : 'Admin Added'}
                            </span>
                        </div>
                    )}
                </div>

                <div className="relative z-10 flex flex-col sm:flex-row gap-3 items-stretch lg:items-center">
                    <form onSubmit={handleSearch} className="relative group">
                        <Search
                            size={18}
                            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-yellow-500 transition-colors"
                        />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search places..."
                            className="pl-10 pr-4 py-3 w-full sm:w-72 bg-black/40 border border-gray-700 focus:border-yellow-500/50 focus:ring-2 focus:ring-yellow-500/20 rounded-xl text-sm text-white transition-all shadow-inner outline-none"
                        />
                    </form>

                    {filters.source === 'tat' && (
                        <button
                            onClick={handleBulkSyncTAT}
                            disabled={bulkSyncing}
                            className="flex items-center justify-center gap-2 px-5 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 disabled:from-gray-700 disabled:to-gray-800 disabled:text-gray-500 text-white font-bold rounded-xl transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:shadow-[0_0_25px_rgba(16,185,129,0.5)] disabled:shadow-none transform hover:-translate-y-0.5 disabled:transform-none"
                        >
                            <RefreshCw size={18} className={bulkSyncing ? 'animate-spin' : ''} />
                            {bulkSyncing ? 'Syncing...' : 'Sync TAT to DB'}
                        </button>
                    )}

                    {filters.source === 'admin' && (
                        <button
                            onClick={() => navigate('/destinations/add')}
                            className="flex items-center justify-center gap-2 px-5 py-3 bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-400 hover:to-yellow-500 text-black font-bold rounded-xl transition-all shadow-[0_0_15px_rgba(234,179,8,0.3)] hover:shadow-[0_0_25px_rgba(234,179,8,0.5)] transform hover:-translate-y-0.5"
                        >
                            <Plus size={18} />
                            Add New
                        </button>
                    )}
                </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-8">
                {/* Filters Sidebar */}
                <div className="lg:w-64 shrink-0 space-y-6">
                    <div className="bg-gray-900 border border-gray-800 rounded-3xl p-6 shadow-xl sticky top-6">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="font-bold text-white flex items-center gap-2">
                                <Filter size={18} className="text-yellow-500" />
                                Filters
                            </h3>
                            <button
                                onClick={() =>
                                    setFilters({ source: 'tat', status: 'all', placeCategory: 'all' })
                                }
                                className="text-xs font-semibold text-yellow-500/80 hover:text-yellow-400 transition-colors px-2 py-1 bg-yellow-500/10 rounded-lg"
                            >
                                Reset
                            </button>
                        </div>

                        {/* Source Filter */}
                        <div className="space-y-3">
                            <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-3">Data Source</p>
                            
                            <label className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer ${filters.source === 'tat' ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-black/20 border-transparent hover:bg-white/5'}`}>
                                <input
                                    type="radio"
                                    name="source-filter"
                                    className="hidden"
                                    checked={filters.source === 'tat'}
                                    onChange={() => setFilters({ ...filters, source: 'tat' })}
                                />
                                <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${filters.source === 'tat' ? 'border-yellow-500' : 'border-gray-500'}`}>
                                    {filters.source === 'tat' && <div className="w-2 h-2 rounded-full bg-yellow-500" />}
                                </div>
                                <span className={`text-sm font-medium ${filters.source === 'tat' ? 'text-yellow-400' : 'text-gray-400'}`}>TAT API</span>
                            </label>

                            <label className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer ${filters.source === 'admin' ? 'bg-blue-500/10 border-blue-500/30' : 'bg-black/20 border-transparent hover:bg-white/5'}`}>
                                <input
                                    type="radio"
                                    name="source-filter"
                                    className="hidden"
                                    checked={filters.source === 'admin'}
                                    onChange={() => setFilters({ ...filters, source: 'admin' })}
                                />
                                <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${filters.source === 'admin' ? 'border-blue-500' : 'border-gray-500'}`}>
                                    {filters.source === 'admin' && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                                </div>
                                <span className={`text-sm font-medium ${filters.source === 'admin' ? 'text-blue-400' : 'text-gray-400'}`}>Admin Added</span>
                            </label>
                        </div>

                        {/* Category Filter (TAT API only) */}
                        {filters.source === 'tat' && (
                            <div className="mt-8 pt-6 border-t border-gray-800 space-y-3">
                                <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-3">หมวดหมู่ (Category)</p>

                                {PLACE_CATEGORIES.map((cat) => (
                                    <label
                                        key={cat.id}
                                        className={`flex items-center p-2.5 rounded-xl transition-all cursor-pointer group ${filters.placeCategory === cat.id ? 'bg-white/10' : 'hover:bg-white/5'}`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <input
                                                type="radio"
                                                name="category-filter"
                                                className="hidden"
                                                checked={filters.placeCategory === cat.id}
                                                onChange={() => setFilters({ ...filters, placeCategory: cat.id })}
                                            />
                                            <div className="w-4 h-4 flex items-center justify-center">
                                                <div className={`w-2.5 h-2.5 rounded-full ${filters.placeCategory === cat.id ? 'bg-yellow-500' : 'bg-gray-600 group-hover:bg-gray-500'} transition-colors`} />
                                            </div>
                                            <span className={`text-sm ${filters.placeCategory === cat.id ? 'text-yellow-400 font-medium' : 'text-gray-400'}`}>{cat.label}</span>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        )}

                        {/* Status Filter */}
                        <div className="mt-8 pt-6 border-t border-gray-800 space-y-3">
                            <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-3">Status</p>

                            {[
                                { id: 'all', label: 'All Status', count: null },
                                { id: 'approved', label: 'Approved', count: statusCounts.approved },
                                { id: 'pending', label: 'Pending', count: statusCounts.pending },
                                { id: 'rejected', label: 'Rejected', count: statusCounts.rejected }
                            ].map((status) => (
                                <label key={status.id} className={`flex items-center justify-between p-2.5 rounded-xl transition-all cursor-pointer group ${filters.status === status.id ? 'bg-white/10' : 'hover:bg-white/5'}`}>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="radio"
                                            name="status-filter"
                                            className="hidden"
                                            checked={filters.status === status.id}
                                            onChange={() => setFilters({ ...filters, status: status.id })}
                                        />
                                        <div className={`w-4 h-4 flex items-center justify-center`}>
                                            <div className={`w-2.5 h-2.5 rounded-full ${filters.status === status.id ? 'bg-white' : 'bg-gray-600 group-hover:bg-gray-500'} transition-colors`} />
                                        </div>
                                        <span className={`text-sm ${filters.status === status.id ? 'text-white font-medium' : 'text-gray-400'}`}>{status.label}</span>
                                    </div>
                                    {status.count !== null && (
                                        <span className="text-xs bg-black/40 text-gray-400 px-2 py-1 rounded-md">{status.count}</span>
                                    )}
                                </label>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 space-y-6">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <LayoutGrid size={20} className="text-gray-400" />
                            Results Showcase
                        </h2>
                    </div>

                    {loading ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <div key={i} className="bg-gray-900 border border-gray-800 rounded-3xl overflow-hidden animate-pulse">
                                    <div className="h-48 bg-gray-800" />
                                    <div className="p-5 space-y-4">
                                        <div className="h-5 bg-gray-800 rounded-md w-3/4" />
                                        <div className="flex gap-2">
                                            <div className="h-4 bg-gray-800 rounded-md w-1/4" />
                                            <div className="h-4 bg-gray-800 rounded-md w-1/4" />
                                        </div>
                                        <div className="h-10 bg-gray-800 rounded-xl w-full mt-4" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                            {allItems.map((item, i) => (
                                <div
                                    key={`${item.source}-${item.id}-${i}`}
                                    className="bg-gray-900 border border-gray-800 rounded-3xl overflow-hidden group hover:border-gray-600 hover:shadow-2xl transition-all duration-300 flex flex-col"
                                >
                                    <div className="h-48 bg-gray-800 relative overflow-hidden">
                                        {item.image ? (
                                            <img
                                                src={item.image}
                                                alt={item.name}
                                                loading="lazy"
                                                decoding="async"
                                                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-in-out"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900">
                                                <Compass size={40} className="text-gray-600 mb-2" />
                                                <span className="text-xs text-gray-500">No Image</span>
                                            </div>
                                        )}
                                        
                                        {/* Overlay Gradient */}
                                        <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/20 to-transparent opacity-80" />

                                        {/* Badges */}
                                        <div className="absolute top-4 right-4 flex flex-col gap-2 items-end">
                                            <span
                                                className={`px-2.5 py-1 text-[10px] font-bold tracking-wider uppercase rounded-lg backdrop-blur-md border ${
                                                    item.source === 'tat_api'
                                                        ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'
                                                        : 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                                                }`}
                                            >
                                                {item.source === 'tat_api' ? 'TAT API' : 'ADMIN'}
                                            </span>
                                            {item.status === 'approved' && (
                                                <span className="px-2 py-1 bg-emerald-500/80 backdrop-blur-md text-white text-[10px] font-bold rounded-lg border border-emerald-400/50">
                                                    APPROVED
                                                </span>
                                            )}
                                            {item.status === 'pending' && (
                                                <span className="px-2 py-1 bg-amber-500/80 backdrop-blur-md text-white text-[10px] font-bold rounded-lg border border-amber-400/50">
                                                    PENDING
                                                </span>
                                            )}
                                            {item.status === 'rejected' && (
                                                <span className="px-2 py-1 bg-rose-500/80 backdrop-blur-md text-white text-[10px] font-bold rounded-lg border border-rose-400/50">
                                                    REJECTED
                                                </span>
                                            )}
                                        </div>

                                        <div className="absolute bottom-4 left-4 right-4">
                                            <h3 className="font-bold text-lg text-white truncate text-shadow-sm group-hover:text-yellow-400 transition-colors">
                                                {item.name}
                                            </h3>
                                        </div>
                                    </div>

                                    <div className="p-5 flex-1 flex flex-col">
                                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4">
                                            <p className="text-xs text-gray-400 flex items-center gap-1.5 bg-white/5 px-2 py-1 rounded-md border border-white/5">
                                                <MapPin size={12} className="text-gray-500" />
                                                <span className="truncate max-w-[120px]">{item.province || 'N/A'}</span>
                                            </p>

                                            {item.category && (
                                                <p className="text-xs text-gray-400 flex items-center gap-1.5 bg-white/5 px-2 py-1 rounded-md border border-white/5">
                                                    <Tag size={12} className="text-gray-500" />
                                                    <span className="truncate max-w-[100px]">{item.category}</span>
                                                </p>
                                            )}

                                            {item.viewer > 0 && (
                                                <span className="text-xs text-gray-400 flex items-center gap-1.5 bg-white/5 px-2 py-1 rounded-md border border-white/5">
                                                    <Eye size={12} className="text-gray-500" />
                                                    {item.viewer.toLocaleString()}
                                                </span>
                                            )}
                                        </div>

                                        {item.tags?.length > 0 && (
                                            <div className="flex gap-1.5 flex-wrap mb-4">
                                                {item.tags.slice(0, 3).map((tag, idx) => (
                                                    <span
                                                        key={idx}
                                                        className="text-[10px] px-2 py-1 rounded-lg bg-black/40 text-gray-400 border border-gray-800"
                                                    >
                                                        #{tag}
                                                    </span>
                                                ))}
                                                {item.tags.length > 3 && (
                                                    <span className="text-[10px] px-2 py-1 rounded-lg bg-black/40 text-gray-500 border border-gray-800">
                                                        +{item.tags.length - 3}
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        <div className="mt-auto pt-4 flex gap-3">
                                            {item.source === 'tat_api' ? (
                                                <>
                                                    <button
                                                        onClick={() => navigate(`/destinations/read-tat/${item.id}`, { state: { introduction: item.introduction } })}
                                                        className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 text-white text-sm font-semibold rounded-xl border border-gray-700 hover:border-gray-500 transition-all text-center flex items-center justify-center gap-2"
                                                    >
                                                        <Eye size={16} />
                                                        View
                                                    </button>
                                                    <button
                                                        onClick={() => handleSingleSyncTAT(item.id, item.name)}
                                                        disabled={syncingId === item.id}
                                                        className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800 disabled:text-gray-500 text-white text-sm font-semibold rounded-xl transition-all text-center flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/30 disabled:shadow-none"
                                                    >
                                                        <RefreshCw size={16} className={syncingId === item.id ? 'animate-spin' : ''} />
                                                        {syncingId === item.id ? 'Syncing' : 'Sync & Embed'}
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <button
                                                        onClick={() => navigate(`/destinations/edit/${item.id}`)}
                                                        className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition-all text-center shadow-lg shadow-blue-500/20 hover:shadow-blue-500/40"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(item.id)}
                                                        className="flex-1 py-2.5 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white text-sm font-semibold rounded-xl transition-all text-center border border-red-500/20 hover:border-transparent"
                                                    >
                                                        Delete
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {allItems.length === 0 && !loading && (
                        <div className="bg-gray-900 border border-gray-800 rounded-3xl p-12 flex flex-col items-center justify-center text-center">
                            <div className="w-20 h-20 bg-gray-800 rounded-full flex items-center justify-center mb-4">
                                <Search size={32} className="text-gray-500" />
                            </div>
                            <h3 className="text-xl font-bold text-white mb-2">No Destinations Found</h3>
                            <p className="text-gray-500 max-w-sm">
                                Try adjusting your search or filters to find what you're looking for, or add a new destination manually.
                            </p>
                        </div>
                    )}

                    {/* Pagination */}
                    {filters.source === 'tat' && totalPages > 1 && (
                        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 mt-8 shadow-lg">
                            <p className="text-sm text-gray-400">
                                Showing page <span className="text-white font-medium">{visiblePage}</span> of <span className="text-white font-medium">{visibleTotalPages}</span>
                            </p>
                            
                            <div className="flex items-center gap-1.5 bg-black/30 p-1.5 rounded-xl border border-gray-800">
                                <button
                                    onClick={() => handlePageChange(page - 1)}
                                    disabled={page <= 1}
                                    className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
                                >
                                    <ChevronLeft size={18} />
                                </button>

                                {getPageNumbers()[0] > 1 && (
                                    <>
                                        <button
                                            onClick={() => handlePageChange(1)}
                                            className="w-10 h-10 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-all"
                                        >
                                            1
                                        </button>
                                        {getPageNumbers()[0] > 2 && (
                                            <span className="text-gray-600 px-1">...</span>
                                        )}
                                    </>
                                )}

                                {getPageNumbers().map((p) => (
                                    <button
                                        key={p}
                                        onClick={() => handlePageChange(p)}
                                        className={`w-10 h-10 rounded-lg text-sm font-medium transition-all ${
                                            p === page
                                                ? 'bg-yellow-500 text-black shadow-lg shadow-yellow-500/20'
                                                : 'text-gray-400 hover:text-white hover:bg-gray-800'
                                        }`}
                                    >
                                        {p}
                                    </button>
                                ))}

                                {getPageNumbers()[getPageNumbers().length - 1] < totalPages && (
                                    <>
                                        {getPageNumbers()[getPageNumbers().length - 1] < totalPages - 1 && (
                                            <span className="text-gray-600 px-1">...</span>
                                        )}
                                        <button
                                            onClick={() => handlePageChange(totalPages)}
                                            className="w-10 h-10 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-all"
                                        >
                                            {totalPages}
                                        </button>
                                    </>
                                )}

                                <button
                                    onClick={() => handlePageChange(page + 1)}
                                    disabled={page >= totalPages}
                                    className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
                                >
                                    <ChevronRight size={18} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Destinations;
