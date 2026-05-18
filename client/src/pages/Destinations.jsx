import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, MapPin, Eye, Tag, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../utils/api';
import { showConfirmAlert, showErrorAlert, showSuccessAlert } from '../utils/alerts';

const PAGE_SIZE = 10;
const DEBOUNCE_MS = 500;

const Destinations = () => {
    const navigate = useNavigate();

    const [adminDests, setAdminDests] = useState([]);
    const [tatDests, setTatDests] = useState([]);
    const [page, setPage] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [loading, setLoading] = useState(false);

    const [filters, setFilters] = useState({
        source: 'tat',
        status: 'all'
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
    const fetchData = useCallback(async (keyword, pageNum, source) => {
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
        fetchData(debouncedSearch, 1, filters.source);
    }, [debouncedSearch, filters.source, fetchData]);

    useEffect(() => {
        setPage(1);
    }, [filters.source]);

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
        fetchData(debouncedSearch, newPage, filters.source);
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
            fetchData(debouncedSearch, page, filters.source);
        } catch (err) {
            console.error('เกิดข้อผิดพลาดในการลบ:', err);
            await showErrorAlert('ลบสถานที่ไม่สำเร็จ');
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
            published: baseItems.filter((status) => status === 'published').length,
            draft: baseItems.filter((status) => status === 'draft').length
        };
    }, [tatDests, adminDests, filters.source]);

    // -----------------------
    // UI
    // -----------------------
    return (
        <div className="p-6">
            {/* Header */}
            <div className="flex justify-between items-start mb-6">
                <div>
                    <p className="text-sm text-gray-500">
                        Home &gt; Destinations
                    </p>
                    <h1
                        className="text-2xl font-bold"
                        style={{ color: '#f0a500' }}
                    >
                        Destinations
                    </h1>
                    {sourceTotalCount > 0 && (
                        <p className="text-xs text-gray-400 mt-1">
                            ทั้งหมด {sourceTotalCount.toLocaleString()} สถานที่ ({filters.source === 'tat' ? 'TAT API' : 'Admin Added'})
                        </p>
                    )}
                </div>

                <div className="flex gap-3 items-center">
                    <form onSubmit={handleSearch} className="relative">
                        <Search
                            size={18}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                        />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search by name"
                            className="input-field !pl-10 !w-72"
                        />
                    </form>

                    <button
                        onClick={() => navigate('/destinations/add')}
                        className="btn-gold flex items-center gap-2"
                    >
                        <Plus size={18} />
                        Destinations
                    </button>
                </div>
            </div>

            <div className="flex gap-6">
                {/* Filters */}
                <div className="w-56 shrink-0">
                    <div className="card">
                        <div className="flex justify-between mb-4">
                            <h3 className="font-semibold text-sm uppercase">
                                Filters
                            </h3>

                            <button
                                onClick={() =>
                                    setFilters({
                                        source: 'tat',
                                        status: 'all'
                                    })
                                }
                                className="text-xs text-yellow-500"
                            >
                                Reset All
                            </button>
                        </div>

                        {/* Source */}
                        <label className="flex items-center gap-2 text-sm mb-1 cursor-pointer">
                            <input
                                type="radio"
                                name="source-filter"
                                checked={filters.source === 'tat'}
                                onChange={() =>
                                    setFilters({
                                        ...filters,
                                        source: 'tat'
                                    })
                                }
                            />
                            TAT API
                        </label>

                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                                type="radio"
                                name="source-filter"
                                checked={filters.source === 'admin'}
                                onChange={() =>
                                    setFilters({
                                        ...filters,
                                        source: 'admin'
                                    })
                                }
                            />
                            Admin Added
                        </label>

                        <div className="mt-4 pt-4 border-t border-gray-700">
                            <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Status</p>

                            <label className="flex items-center gap-2 text-sm mb-1 cursor-pointer">
                                <input
                                    type="radio"
                                    name="status-filter"
                                    checked={filters.status === 'all'}
                                    onChange={() =>
                                        setFilters({
                                            ...filters,
                                            status: 'all'
                                        })
                                    }
                                />
                                All
                            </label>

                            <label className="flex items-center gap-2 text-sm mb-1 cursor-pointer">
                                <input
                                    type="radio"
                                    name="status-filter"
                                    checked={filters.status === 'published'}
                                    onChange={() =>
                                        setFilters({
                                            ...filters,
                                            status: 'published'
                                        })
                                    }
                                />
                                Published
                                <span className="ml-auto text-gray-400">{statusCounts.published}</span>
                            </label>

                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <input
                                    type="radio"
                                    name="status-filter"
                                    checked={filters.status === 'draft'}
                                    onChange={() =>
                                        setFilters({
                                            ...filters,
                                            status: 'draft'
                                        })
                                    }
                                />
                                Draft
                                <span className="ml-auto text-gray-400">{statusCounts.draft}</span>
                            </label>
                        </div>
                    </div>
                </div>

                {/* Cards */}
                <div className="flex-1">
                    {loading && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-5">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <div key={i} className="card p-0 overflow-hidden animate-pulse">
                                    <div className="h-44 bg-gray-700" />
                                    <div className="p-4 space-y-3">
                                        <div className="h-4 bg-gray-700 rounded w-3/4" />
                                        <div className="h-3 bg-gray-700 rounded w-1/2" />
                                        <div className="h-3 bg-gray-700 rounded w-1/3" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        {allItems.map((item, i) => (
                            <div
                                key={`${item.source}-${item.id}-${i}`}
                                className="card p-0 overflow-hidden group"
                            >
                                <div className="h-44 bg-gray-700 relative overflow-hidden">
                                    {item.image ? (
                                        <img
                                            src={item.image}
                                            alt={item.name}
                                            loading="lazy"
                                            decoding="async"
                                            className="w-full h-full object-cover group-hover:scale-105 transition"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center">
                                            <MapPin
                                                size={40}
                                                className="text-gray-500"
                                            />
                                        </div>
                                    )}

                                    <span
                                        className={`badge absolute top-3 right-3 ${item.source === 'tat_api'
                                            ? 'badge-tat'
                                            : 'badge-admin'
                                            }`}
                                    >
                                        {item.source === 'tat_api'
                                            ? 'TAT API'
                                            : 'ADMIN'}
                                    </span>
                                </div>

                                <div className="p-4">
                                    <h3 className="font-semibold text-sm truncate">
                                        {item.name}
                                    </h3>

                                    <p className="text-xs text-gray-400 flex items-center gap-1 mt-1">
                                        <MapPin size={12} />
                                        {item.province || 'N/A'}
                                    </p>

                                    {item.category && (
                                        <p className="text-xs text-gray-400 flex items-center gap-1 mt-1">
                                            <Tag size={12} />
                                            {item.category}
                                        </p>
                                    )}


                                    <div className="flex items-center gap-3 mt-2">
                                        {item.viewer > 0 && (
                                            <span className="text-xs text-gray-500 flex items-center gap-1">
                                                <Eye size={10} />
                                                {item.viewer.toLocaleString()}
                                            </span>
                                        )}
                                        {item.tags.length > 0 && (
                                            <div className="flex gap-1 flex-wrap">
                                                {item.tags.slice(0, 2).map((tag, idx) => (
                                                    <span
                                                        key={idx}
                                                        className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400"
                                                    >
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex gap-2 mt-4 pt-4 border-t border-gray-700">
                                        {item.source === 'tat_api' ? (
                                            <button
                                                onClick={() =>
                                                    navigate(
                                                        `/destinations/read-tat/${item.id}`,
                                                        { state: { introduction: item.introduction } }
                                                    )
                                                }
                                                className="destination-action-btn destination-action-btn-secondary w-full"
                                            >
                                                Read
                                            </button>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={() =>
                                                        navigate(
                                                            `/destinations/edit/${item.id}`
                                                        )
                                                    }
                                                    className="destination-action-btn destination-action-btn-primary flex-1"
                                                >
                                                    Manage
                                                </button>

                                                <button
                                                    onClick={() =>
                                                        handleDelete(item.id)
                                                    }
                                                    className="destination-action-btn destination-action-btn-danger flex-1"
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

                    {allItems.length === 0 && !loading && (
                        <div className="text-center py-12 text-gray-500">
                            ไม่พบข้อมูลสถานที่
                        </div>
                    )}

                    {/* Pagination */}
                    {filters.source === 'tat' && totalPages > 1 && (
                        <div className="flex items-center justify-center gap-2 mt-8">
                            <button
                                onClick={() => handlePageChange(page - 1)}
                                disabled={page <= 1}
                                className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition"
                            >
                                <ChevronLeft size={18} />
                            </button>

                            {getPageNumbers()[0] > 1 && (
                                <>
                                    <button
                                        onClick={() => handlePageChange(1)}
                                        className="w-9 h-9 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 transition"
                                    >
                                        1
                                    </button>
                                    {getPageNumbers()[0] > 2 && (
                                        <span className="text-gray-500 text-sm px-1">...</span>
                                    )}
                                </>
                            )}

                            {getPageNumbers().map((p) => (
                                <button
                                    key={p}
                                    onClick={() => handlePageChange(p)}
                                    className={`w-9 h-9 rounded-lg text-sm transition ${p === page
                                        ? 'font-bold text-black'
                                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                                        }`}
                                    style={p === page ? { background: '#f0a500' } : {}}
                                >
                                    {p}
                                </button>
                            ))}

                            {getPageNumbers()[getPageNumbers().length - 1] < totalPages && (
                                <>
                                    {getPageNumbers()[getPageNumbers().length - 1] < totalPages - 1 && (
                                        <span className="text-gray-500 text-sm px-1">...</span>
                                    )}
                                    <button
                                        onClick={() => handlePageChange(totalPages)}
                                        className="w-9 h-9 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 transition"
                                    >
                                        {totalPages}
                                    </button>
                                </>
                            )}

                            <button
                                onClick={() => handlePageChange(page + 1)}
                                disabled={page >= totalPages}
                                className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition"
                            >
                                <ChevronRight size={18} />
                            </button>
                        </div>
                    )}

                    <p className="text-center text-sm text-gray-500 mt-4">
                        หน้า {visiblePage} / {visibleTotalPages} — แสดง {allItems.length} รายการ
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Destinations;
