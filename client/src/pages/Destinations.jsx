import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { showConfirmAlert, showErrorAlert, showSuccessAlert } from '../utils/alerts';
import DestinationsView from '../components/destinations/DestinationsView';
import {
    DEBOUNCE_MS,
    getVisiblePageNumbers,
    normalizeDestinationItems,
    PAGE_SIZE,
    PLACE_CATEGORIES
} from '../utils/destinationList';

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
    const [embeddingQueueing, setEmbeddingQueueing] = useState(false);
    const [statusCounts, setStatusCounts] = useState({
        approved: 0,
        pending: 0,
        rejected: 0
    });

    const [filters, setFilters] = useState({
        source: 'tat',
        status: 'all',
        placeCategory: 'all'
    });

    const abortRef = useRef(null);
    const debounceRef = useRef(null);
    const requestIdRef = useRef(0);

    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    const sourceTotalCount = totalItems;

    // -----------------------
    // หน่วงการค้นหาเพื่อลดจำนวนคำขอ
    // -----------------------
    useEffect(() => {
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setDebouncedSearch(search);
        }, DEBOUNCE_MS);
        return () => clearTimeout(debounceRef.current);
    }, [search]);

    // -----------------------
    // ดึงข้อมูลทั้งหมดพร้อมกัน
    // -----------------------
    const fetchData = useCallback(async (keyword, pageNum, source, placeCategory, status) => {
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
                if (status && status !== 'all') adminParams.set('status', status);
                adminParams.set('limit', PAGE_SIZE);
                adminParams.set('page', pageNum);

                const adminRes = await api.get(`/destinations?${adminParams}`, {
                    signal: controller.signal
                });

                if (requestIdRef.current !== currentRequestId) {
                    return;
                }

                const adminItems = Array.isArray(adminRes.data?.data) ? adminRes.data.data : [];
                const pagination = adminRes.data?.pagination || {};
                setAdminDests(adminItems);
                setTatDests([]);
                setTotalItems(pagination.total || 0);
                setStatusCounts(adminRes.data?.statusCounts || {
                    approved: 0,
                    pending: 0,
                    rejected: 0
                });
            } else {
                const tatParams = new URLSearchParams();
                if (keyword) tatParams.set('keyword', keyword);
                if (placeCategory && placeCategory !== 'all') {
                    tatParams.set('place_category', placeCategory);
                }
                tatParams.set('limit', PAGE_SIZE);
                tatParams.set('page', pageNum);

                const tatRes = await api.get(`/v2/places?${tatParams}`, {
                    signal: controller.signal,
                    headers: { 'Accept-Language': 'th' }
                });

                if (requestIdRef.current !== currentRequestId) {
                    return;
                }

                const results = tatRes.data?.data || [];
                const pagination = tatRes.data?.pagination || {};
                setTatDests(Array.isArray(results) ? results : []);
                setAdminDests([]);
                setTotalItems(pagination.total || 0);
                setStatusCounts({ approved: 0, pending: 0, rejected: 0 });
            }
        } catch (err) {
            if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
                return;
            }

            console.error('เกิดข้อผิดพลาดในการโหลดข้อมูล:', err);
            setAdminDests([]);
            setTatDests([]);
            setTotalItems(0);
            setStatusCounts({ approved: 0, pending: 0, rejected: 0 });
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
    // โหลดข้อมูลเมื่อคำค้นหาหรือหน้าเปลี่ยน
    // -----------------------
    useEffect(() => {
        setPage(1);
        fetchData(debouncedSearch, 1, filters.source, filters.placeCategory, filters.status);
    }, [debouncedSearch, filters.source, filters.placeCategory, filters.status, fetchData]);

    useEffect(() => {
        return () => {
            abortRef.current?.abort();
        };
    }, []);

    // -----------------------
    // ส่งคำค้นหา
    // -----------------------
    const handleSearch = (e) => {
        e.preventDefault();
        clearTimeout(debounceRef.current);
        setDebouncedSearch(search);
    };

    // -----------------------
    // การแบ่งหน้า
    // -----------------------
    const handlePageChange = (newPage) => {
        if (newPage < 1 || newPage > totalPages) return;
        setPage(newPage);
        fetchData(debouncedSearch, newPage, filters.source, filters.placeCategory, filters.status);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // -----------------------
    // ลบสถานที่ของผู้ดูแลระบบ
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
            fetchData(debouncedSearch, page, filters.source, filters.placeCategory, filters.status);
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
            title: 'ซิงก์สถานที่จาก TAT API หรือไม่?',
            text: `ระบบจะซิงก์ข้อมูลทั้งหมดก่อน (หมวดหมู่: ${activeCategory}, คำค้น: "${debouncedSearch || 'ทั้งหมด'}") แล้วจึงเข้าคิวสร้างข้อมูลค้นหา AI เฉพาะสถานที่ที่ยังไม่มี`,
            confirmButtonText: 'เริ่มซิงก์',
            cancelButtonText: 'ยกเลิก'
        });

        if (!result.isConfirmed) return;

        setBulkSyncing(true);
        try {
            const res = await api.post('/admin/sync/tat', {
                keyword: debouncedSearch,
                placeCategory: filters.placeCategory !== 'all' ? filters.placeCategory : undefined
            });
            await showSuccessAlert(res.data?.message || 'เริ่มซิงก์ข้อมูลทั้งหมดแล้ว ระบบกำลังดำเนินการในเบื้องหลัง');
        } catch (err) {
            console.error('เกิดข้อผิดพลาดในการ Bulk Sync:', err);
            await showErrorAlert(err.response?.data?.message || 'สั่งซิงก์ข้อมูลไม่สำเร็จ');
        } finally {
            setBulkSyncing(false);
        }
    };

    const handleQueueMissingEmbeddings = async () => {
        setEmbeddingQueueing(true);
        try {
            const res = await api.post('/admin/embed/bulk');
            await showSuccessAlert(res.data?.message || 'เริ่มคิวสร้างข้อมูลค้นหา AI แล้ว');
        } catch (err) {
            console.error('เกิดข้อผิดพลาดในการเริ่มคิว embedding:', err);
            await showErrorAlert(err.response?.data?.message || 'เริ่มคิวสร้างข้อมูลค้นหา AI ไม่สำเร็จ');
        } finally {
            setEmbeddingQueueing(false);
        }
    };

    const handleSingleSyncTAT = async (tatPlaceId, name) => {
        const result = await showConfirmAlert({
            title: 'ซิงก์สถานที่นี้หรือไม่?',
            text: `ต้องการดึงข้อมูล "${name}" เข้าฐานข้อมูลและสร้างข้อมูลค้นหาสำหรับ AI ใช่หรือไม่?`,
            confirmButtonText: 'เริ่มซิงก์',
            cancelButtonText: 'ยกเลิก'
        });

        if (!result.isConfirmed) return;

        setSyncingId(tatPlaceId);
        try {
            await api.post(`/admin/sync/tat/${tatPlaceId}`);
            await showSuccessAlert(`ซิงก์ข้อมูลสำหรับ "${name}" สำเร็จแล้ว`);
        } catch (err) {
            console.error('เกิดข้อผิดพลาดในการ Sync รายบุคคล:', err);
            await showErrorAlert(err.response?.data?.message || 'ซิงก์สถานที่ไม่สำเร็จ');
        } finally {
            setSyncingId(null);
        }
    };

    const allItems = useMemo(() => normalizeDestinationItems({
        source: filters.source,
        status: filters.status,
        tatItems: tatDests,
        adminItems: adminDests
    }), [tatDests, adminDests, filters.source, filters.status]);

    const pageNumbers = getVisiblePageNumbers(page, totalPages);

    // -----------------------
    // ส่วนติดต่อผู้ใช้
    // -----------------------

    return (
        <DestinationsView
            navigate={navigate}
            sourceTotalCount={sourceTotalCount}
            filters={filters}
            setFilters={setFilters}
            search={search}
            setSearch={setSearch}
            handleSearch={handleSearch}
            handleBulkSyncTAT={handleBulkSyncTAT}
            bulkSyncing={bulkSyncing}
            embeddingQueueing={embeddingQueueing}
            handleQueueMissingEmbeddings={handleQueueMissingEmbeddings}
            placeCategories={PLACE_CATEGORIES}
            statusCounts={statusCounts}
            loading={loading}
            allItems={allItems}
            syncingId={syncingId}
            handleSingleSyncTAT={handleSingleSyncTAT}
            handleDelete={handleDelete}
            page={page}
            totalPages={totalPages}
            pageNumbers={pageNumbers}
            handlePageChange={handlePageChange}
        />
    );
};

export default Destinations;
