import { useEffect, useMemo, useState } from 'react';
import {
    Plus,
    Pencil,
    Trash2,
    RefreshCw,
    X,
    Heart,
    Route,
    Power,
    Eye,
    EyeOff,
    Tags,
    Upload,
    ImageIcon,
    GripVertical,
} from 'lucide-react';
import api from '../utils/api';
import { resolveAssetUrl } from '../config';
import {
    showConfirmAlert,
    showErrorAlert,
    showSuccessAlert,
    showWarningAlert,
} from '../utils/alerts';

const TYPE_TABS = [
    { value: 'interest', label: 'ความสนใจ', icon: Heart },
    { value: 'transport_mode', label: 'รูปแบบการเดินทาง', icon: Route },
];

const emptyForm = (type) => ({
    type,
    key: '',
    label_th: '',
    label_en: '',
    icon_url: '',
    is_active: true,
});

// สร้าง payload สำหรับ PUT จากข้อมูลรายการ (ใช้เมื่อสลับลำดับ/สลับสถานะ)
const toPayload = (item) => ({
    type: item.type,
    key: item.key,
    label_th: item.label_th,
    label_en: item.label_en,
    icon_url: item.icon_url || null,
    is_active: item.is_active,
    sort_order: item.sort_order,
});

const PlanOptions = () => {
    const [options, setOptions] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeType, setActiveType] = useState('interest');
    const [modal, setModal] = useState(null); // null | { mode: 'add' } | { mode: 'edit', item }
    const [form, setForm] = useState(emptyForm('interest'));
    const [saving, setSaving] = useState(false);
    const [uploadingIcon, setUploadingIcon] = useState(false);
    const [draggedIndex, setDraggedIndex] = useState(null);
    const [dragOverIndex, setDragOverIndex] = useState(null);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const res = await api.get('/preferences');
            setOptions(Array.isArray(res.data?.data) ? res.data.data : []);
        } catch (err) {
            console.error('Error fetching plan options:', err);
            await showErrorAlert('ไม่สามารถโหลดตัวเลือกแผนเที่ยวได้');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const currentList = useMemo(
        () => options
            .filter((item) => item.type === activeType)
            .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
        [options, activeType],
    );

    const activeCount = currentList.filter((item) => item.is_active).length;
    const inactiveCount = currentList.length - activeCount;

    const openAdd = () => {
        setForm(emptyForm(activeType));
        setModal({ mode: 'add' });
    };

    const openEdit = (item) => {
        setForm({
            type: item.type,
            key: item.key,
            label_th: item.label_th,
            label_en: item.label_en,
            icon_url: item.icon_url || '',
            is_active: item.is_active,
        });
        setModal({ mode: 'edit', item });
    };

    const handleChange = (field, value) => {
        setForm((prev) => ({ ...prev, [field]: value }));
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        setUploadingIcon(true);
        try {
            const res = await api.post('/preferences/upload-icon', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            if (res.data?.url) {
                setForm((prev) => ({ ...prev, icon_url: res.data.url }));
            }
        } catch (err) {
            console.error('Error uploading icon:', err);
            await showErrorAlert(err.response?.data?.message || 'อัปโหลดรูปภาพไม่สำเร็จ');
        } finally {
            setUploadingIcon(false);
        }
    };

    const handleSubmit = async () => {
        if (!form.key.trim()) {
            await showWarningAlert('กรุณากรอกคีย์ตัวเลือก (ใช้เป็นค่าในการค้นหา AI)');
            return;
        }
        if (!form.label_th.trim() || !form.label_en.trim()) {
            await showWarningAlert('กรุณากรอกชื่อภาษาไทยและภาษาอังกฤษ');
            return;
        }

        setSaving(true);
        try {
            const payload = {
                ...form,
                key: form.key.trim().toLowerCase(),
                label_th: form.label_th.trim(),
                label_en: form.label_en.trim(),
            };

            if (modal.mode === 'add') {
                await api.post('/preferences', payload);
                await showSuccessAlert('เพิ่มตัวเลือกเรียบร้อยแล้ว');
            } else {
                await api.put(`/preferences/${modal.item.id}`, payload);
                await showSuccessAlert('แก้ไขตัวเลือกเรียบร้อยแล้ว');
            }
            setModal(null);
            await fetchData();
        } catch (err) {
            console.error('Error saving plan option:', err);
            await showErrorAlert(
                err.response?.data?.message || 'บันทึกตัวเลือกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
            );
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (item) => {
        const result = await showConfirmAlert({
            title: 'ลบตัวเลือกนี้?',
            text: `"${item.label_th}" จะถูกลบออกจากระบบ แผนเที่ยวที่สร้างไว้แล้วจะไม่ได้รับผลกระทบ`,
            confirmButtonText: 'ลบตัวเลือก',
            cancelButtonText: 'ยกเลิก',
        });

        if (!result.isConfirmed) return;

        try {
            await api.delete(`/preferences/${item.id}`);
            await showSuccessAlert('ลบตัวเลือกเรียบร้อยแล้ว');
            await fetchData();
        } catch (err) {
            console.error('Error deleting plan option:', err);
            await showErrorAlert(
                err.response?.data?.message || 'ลบตัวเลือกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
            );
        }
    };

    const handleToggleActive = async (item) => {
        try {
            await api.put(`/preferences/${item.id}`, {
                ...toPayload(item),
                is_active: !item.is_active,
            });
            await fetchData();
        } catch (err) {
            console.error('Error toggling plan option:', err);
            await showErrorAlert(
                err.response?.data?.message || 'เปลี่ยนสถานะไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
            );
        }
    };

    const handleDragStart = (e, index) => {
        setDraggedIndex(index);
        setDragOverIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
    };

    const handleDragOver = (e, index) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragOverIndex !== index) setDragOverIndex(index);
    };

    const handleDragEnd = () => {
        setDraggedIndex(null);
        setDragOverIndex(null);
    };

    const handleDrop = async (e, targetIndex) => {
        e.preventDefault();
        const sourceIndex = draggedIndex ?? Number(e.dataTransfer.getData('text/plain'));
        setDraggedIndex(null);
        setDragOverIndex(null);

        if (!Number.isInteger(sourceIndex) || sourceIndex === targetIndex) return;

        const reordered = [...currentList];
        const [movedItem] = reordered.splice(sourceIndex, 1);
        reordered.splice(targetIndex, 0, movedItem);
        const targetOrders = currentList.map((item) => item.sort_order);
        const temporaryOrder = Math.max(...targetOrders, 0) + 1000000;

        try {
            await api.put(`/preferences/${movedItem.id}`, {
                ...toPayload(movedItem),
                sort_order: temporaryOrder,
            });

            await Promise.all(reordered.map((item, index) => {
                if (item.id === movedItem.id) return null;
                return api.put(`/preferences/${item.id}`, {
                    ...toPayload(item),
                    sort_order: targetOrders[index],
                });
            }).filter(Boolean));

            await api.put(`/preferences/${movedItem.id}`, {
                ...toPayload(movedItem),
                sort_order: targetOrders[targetIndex],
            });
            await fetchData();
        } catch (err) {
            console.error('Error dragging plan option:', err);
            await showErrorAlert('จัดลำดับไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
            await fetchData();
        }
    };

    const isTransportTab = activeType === 'transport_mode';

    return (
        <div className="w-full space-y-3 p-3">
            {/* HEADER */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 bg-gradient-to-r from-gray-900 to-gray-800 p-3 rounded-xl border border-gray-800 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />

                <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="px-3 py-1 rounded-full bg-yellow-500/10 text-yellow-500 text-xs font-bold tracking-widest uppercase border border-yellow-500/20">
                            ตัวเลือกแผนเที่ยว
                        </span>
                    </div>
                    <h1 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
                        จัดการตัวเลือกแผนเที่ยว
                    </h1>
                    <p className="text-gray-400 mt-1 text-sm max-w-xl leading-relaxed">
                        กำหนดตัวเลือก "คุณชอบอะไร" และ "คุณเดินทางแบบใดได้บ้าง" ที่แสดงในหน้าสร้างแผนเที่ยวของแอป
                        รองรับภาษาไทยและภาษาอังกฤษ และจัดลำดับการแสดงผลได้
                    </p>
                </div>

                <div className="relative z-10 flex items-center gap-2">
                    <button
                        onClick={fetchData}
                        disabled={isLoading}
                        className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-gray-700 rounded-xl text-sm font-medium text-gray-300 disabled:opacity-50"
                    >
                        <RefreshCw size={16} className={isLoading ? 'text-yellow-400 animate-spin' : 'text-yellow-400'} />
                        รีเฟรชข้อมูล
                    </button>
                    <button
                        onClick={openAdd}
                        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-yellow-500 to-yellow-600 text-black font-bold rounded-xl shadow-[0_0_15px_rgba(234,179,8,0.3)]"
                    >
                        <Plus size={16} />
                        เพิ่มตัวเลือก
                    </button>
                </div>
            </div>

            {/* STAT CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 shadow-lg group relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-[0.03]">
                        <Tags size={40} />
                    </div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 rounded-lg bg-yellow-500/10 text-yellow-400 ring-1 ring-yellow-500/20">
                            <Tags size={16} />
                        </div>
                        <p className="font-semibold text-gray-400">ตัวเลือกทั้งหมด</p>
                    </div>
                    <p className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
                        {currentList.length}
                    </p>
                </div>

                <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 shadow-lg group relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-[0.03]">
                        <Power size={40} className="text-emerald-500" />
                    </div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20">
                            <Power size={16} />
                        </div>
                        <p className="font-semibold text-gray-400">ใช้งานอยู่</p>
                    </div>
                    <p className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
                        {activeCount}
                    </p>
                </div>

                <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 shadow-lg group relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-[0.03]">
                        <EyeOff size={40} className="text-red-500" />
                    </div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 rounded-lg bg-red-500/10 text-red-400 ring-1 ring-red-500/20">
                            <EyeOff size={16} />
                        </div>
                        <p className="font-semibold text-gray-400">ปิดใช้งาน</p>
                    </div>
                    <p className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
                        {inactiveCount}
                    </p>
                </div>
            </div>

            {/* TABS + TABLE */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-xl overflow-hidden">
                <div className="flex flex-col gap-3 border-b border-gray-800 bg-gray-900/80 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex gap-2">
                        {TYPE_TABS.map((tab) => {
                            const Icon = tab.icon;
                            const isActive = tab.value === activeType;
                            return (
                                <button
                                    key={tab.value}
                                    onClick={() => setActiveType(tab.value)}
                                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
                                        isActive
                                            ? 'bg-yellow-500/15 text-yellow-400 ring-1 ring-yellow-500/40'
                                            : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
                                    }`}
                                >
                                    <Icon size={16} />
                                    {tab.label}
                                    <span
                                        className={`px-1.5 py-0.5 text-[10px] rounded-md ${
                                            isActive
                                                ? 'bg-yellow-500/20 text-yellow-300'
                                                : 'bg-white/10 text-gray-400'
                                        }`}
                                    >
                                        {options.filter((item) => item.type === tab.value).length}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="overflow-x-auto custom-scrollbar bg-gray-900/30">
                    <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-gray-900/95 backdrop-blur-md text-xs text-gray-500 font-semibold uppercase tracking-wider z-10 shadow-sm border-b border-gray-800">
                            <tr>
                                <th className="py-2.5 px-3 w-24">ลำดับ</th>
                                <th className="py-2.5 px-3">คีย์</th>
                                <th className="py-2.5 px-3">ภาษาไทย</th>
                                <th className="py-2.5 px-3">English</th>
                                <th className="py-2.5 px-3">สถานะ</th>
                                {isTransportTab && <th className="py-2.5 px-3 w-16">ไอคอน</th>}
                                <th className="py-2.5 px-3 text-right">การจัดการ</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800/50">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={isTransportTab ? 7 : 6} className="py-16 text-center text-gray-500">
                                        กำลังโหลดข้อมูล...
                                    </td>
                                </tr>
                            ) : currentList.length === 0 ? (
                                <tr>
                                    <td colSpan={isTransportTab ? 7 : 6} className="py-16 text-center text-gray-500">
                                        ยังไม่มีตัวเลือกในหมวดหมู่นี้
                                    </td>
                                </tr>
                            ) : currentList.map((item, index) => {
                                const iconSrc = item.icon_url ? resolveAssetUrl(item.icon_url) : null;
                                return (
                                    <tr
                                        key={item.id}
                                        draggable
                                        onDragStart={(e) => handleDragStart(e, index)}
                                        onDragOver={(e) => handleDragOver(e, index)}
                                        onDrop={(e) => handleDrop(e, index)}
                                        onDragEnd={handleDragEnd}
                                        className={`group cursor-grab active:cursor-grabbing transition-colors ${
                                            draggedIndex === index ? 'opacity-40' : ''
                                        } ${
                                            dragOverIndex === index && draggedIndex !== index
                                                ? 'bg-yellow-500/10'
                                                : ''
                                        }`}
                                    >
                                        <td className="py-2 px-3">
                                            <div className="flex items-center gap-1">
                                                <GripVertical size={16} className="text-gray-600 group-hover:text-yellow-400 shrink-0" aria-label="ลากเพื่อจัดลำดับ" />
                                                <span className="text-sm text-gray-400 font-mono w-6">
                                                    {item.sort_order}
                                                </span>

                                            </div>
                                        </td>
                                        <td className="py-2 px-3">
                                            <code className="px-2 py-1 rounded-md bg-black/40 text-yellow-300/90 text-xs font-mono">
                                                {item.key}
                                            </code>
                                        </td>
                                        <td className="py-2 px-3 font-semibold text-gray-200">
                                            {item.label_th}
                                        </td>
                                        <td className="py-2 px-3 text-gray-400">
                                            {item.label_en}
                                        </td>

                                        <td className="py-2 px-3">
                                            <button
                                                onClick={() => handleToggleActive(item)}
                                                className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg border transition-colors ${
                                                    item.is_active
                                                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                                        : 'bg-gray-500/10 text-gray-400 border-gray-600/30'
                                                }`}
                                                title={item.is_active ? 'คลิกเพื่อปิดใช้งาน' : 'คลิกเพื่อเปิดใช้งาน'}
                                            >
                                                {item.is_active ? <Eye size={13} /> : <EyeOff size={13} />}
                                                {item.is_active ? 'ใช้งานอยู่' : 'ปิดใช้งาน'}
                                            </button>
                                        </td>

                                        {isTransportTab && (
                                            <td className="py-2 px-3">
                                                {iconSrc ? (
                                                    <img
                                                        src={iconSrc}
                                                        alt={item.key}
                                                        className="w-8 h-8 object-contain rounded-lg bg-white/90 border border-gray-700 p-1 shadow-sm"
                                                    />
                                                ) : (
                                                    <div className="w-8 h-8 rounded-lg bg-white/10 border border-dashed border-gray-700 flex items-center justify-center text-gray-400">
                                                        <ImageIcon size={14} />
                                                    </div>
                                                )}
                                            </td>
                                        )}

                                        <td className="py-2 px-3 text-right">
                                            <div className="inline-flex items-center gap-1.5">
                                                <button
                                                    onClick={() => openEdit(item)}
                                                    className="p-2 rounded-lg bg-white/5 border border-gray-700 text-gray-300 hover:text-yellow-400 hover:border-yellow-500/40 transition-colors"
                                                    title="แก้ไข"
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(item)}
                                                    className="p-2 rounded-lg bg-white/5 border border-gray-700 text-gray-300 hover:text-red-400 hover:border-red-500/40 transition-colors"
                                                    title="ลบ"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ADD / EDIT MODAL */}
            {modal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                    <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
                            <h2 className="text-lg font-bold text-white">
                                {modal.mode === 'add' ? 'เพิ่มตัวเลือกใหม่' : 'แก้ไขตัวเลือก'}
                            </h2>
                            <button
                                onClick={() => setModal(null)}
                                className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="p-5 space-y-4">
                            {isTransportTab && (
                                <div>
                                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">
                                        รูปภาพ Icon
                                    </label>
                                    <div className="flex items-center gap-3">
                                        {form.icon_url ? (
                                            <img
                                                src={resolveAssetUrl(form.icon_url)}
                                                alt="Preview"
                                                className="w-12 h-12 object-contain rounded-xl bg-white/90 border border-gray-700 p-1.5 shadow-sm"
                                            />
                                        ) : (
                                            <div className="w-12 h-12 rounded-xl bg-black/60 border border-dashed border-gray-700 flex items-center justify-center text-gray-500">
                                                <ImageIcon size={20} />
                                            </div>
                                        )}
                                        <div className="flex flex-col gap-1">
                                            <label className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-gray-700 rounded-xl text-xs font-semibold text-gray-300 hover:text-white hover:bg-white/10 cursor-pointer transition-colors w-fit">
                                                <Upload size={14} className="text-yellow-400" />
                                                {uploadingIcon ? 'กำลังอัปโหลด...' : 'อัปโหลดรูป Icon'}
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    className="hidden"
                                                    disabled={uploadingIcon}
                                                    onChange={handleFileUpload}
                                                />
                                            </label>
                                            {form.icon_url && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleChange('icon_url', '')}
                                                    className="text-[11px] text-red-400 hover:underline text-left"
                                                >
                                                    ลบรูปภาพ
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">
                                    คีย์ (key)
                                </label>
                                <input
                                    className="w-full bg-black/40 border border-gray-700 rounded-xl px-4 py-2.5 text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500/50 focus:border-yellow-500"
                                    placeholder={isTransportTab ? 'เช่น motorcycle' : 'เช่น market'}
                                    value={form.key}
                                    onChange={(e) => handleChange('key', e.target.value)}
                                />
                                <p className="text-[11px] text-gray-500 mt-1.5">
                                    ใช้เป็นค่าในการค้นหาสถานที่ของ AI ควรเป็นภาษาอังกฤษตัวพิมพ์เล็ก
                                </p>
                            </div>

                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">
                                    ชื่อภาษาไทย
                                </label>
                                <input
                                    className="w-full bg-black/40 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/50 focus:border-yellow-500"
                                    placeholder={isTransportTab ? 'เช่น รถจักรยานยนต์' : 'เช่น ตลาด'}
                                    value={form.label_th}
                                    onChange={(e) => handleChange('label_th', e.target.value)}
                                />
                            </div>

                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">
                                    ชื่อภาษาอังกฤษ
                                </label>
                                <input
                                    className="w-full bg-black/40 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/50 focus:border-yellow-500"
                                    placeholder={isTransportTab ? 'เช่น Motorcycle' : 'เช่น Market'}
                                    value={form.label_en}
                                    onChange={(e) => handleChange('label_en', e.target.value)}
                                />
                            </div>

                            <label className="flex items-center gap-3 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={form.is_active}
                                    onChange={(e) => handleChange('is_active', e.target.checked)}
                                    className="w-4 h-4 accent-yellow-500"
                                />
                                <span className="text-sm text-gray-300 font-medium">
                                    ใช้งานตัวเลือกนี้ในแอป
                                </span>
                            </label>
                        </div>

                        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-800 bg-gray-900/60">
                            <button
                                onClick={() => setModal(null)}
                                className="px-4 py-2 bg-transparent text-gray-400 hover:text-white rounded-xl text-sm font-semibold"
                            >
                                ยกเลิก
                            </button>
                            <button
                                onClick={handleSubmit}
                                disabled={saving}
                                className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-yellow-500 to-yellow-600 text-black font-bold rounded-xl shadow-[0_0_15px_rgba(234,179,8,0.3)] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                            >
                                {saving ? 'กำลังบันทึก...' : modal.mode === 'add' ? 'เพิ่มตัวเลือก' : 'บันทึก'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: rgba(255, 255, 255, 0.2);
                }
            `}</style>
        </div>
    );
};

export default PlanOptions;
