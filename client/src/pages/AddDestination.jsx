import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, X, Maximize2, ImagePlus, Search, MapPin } from 'lucide-react';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import 'leaflet/dist/leaflet.css';
import api from '../utils/api';
import { appConfig } from '../config';
import { showErrorAlert, showSuccessAlert, showWarningAlert } from '../utils/alerts';
import ImageLightbox from '../components/ImageLightbox';
import AuthenticatedImage from '../components/AuthenticatedImage';
import {
    DESTINATION_EDITOR_MODULES,
    MapClickHandler,
    MapResizeTrigger,
    MapUpdater,
    useThaiDestinationEditorLabels,
} from '../components/destinationEditorShared';

const AddDestination = () => {
    const navigate = useNavigate();
    const fileInputRef = useRef(null);
    useThaiDestinationEditorLabels();

    const [form, setForm] = useState({
        name: '', address: '',
        province_id: '', province: '', district_id: '', district: '',
        sub_district_id: '', sub_district: '', postcode: '', description: '',
        latitude: '', longitude: '',
        status: 'approved',
        admission_adult: '', admission_child: '',
        admission_foreigner_adult: '', admission_foreigner_child: ''
    });
    const [images, setImages] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [mapExpanded, setMapExpanded] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                if (lightboxIndex != null) setLightboxIndex(null);
                else if (mapExpanded) setMapExpanded(false);
                else navigate('/destinations');
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [lightboxIndex, mapExpanded, navigate]);

    const handleChange = (field, value) => {
        setForm(prev => ({ ...prev, [field]: value }));
    };

    // -----------------------
    // Map helpers
    // -----------------------
    const lat = parseFloat(form.latitude);
    const lng = parseFloat(form.longitude);
    const hasValidCoords = !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;
    const mapCenter = useMemo(() => hasValidCoords ? [lat, lng] : [13.7563, 100.5018], [lat, lng, hasValidCoords]);

    const handleLocationSelect = (newLat, newLng) => {
        handleChange('latitude', newLat.toFixed(6));
        handleChange('longitude', newLng.toFixed(6));
    };

    const searchLocation = async (e) => {
        if (e) e.preventDefault();
        if (!searchQuery.trim()) return;
        setIsSearching(true);
        try {
            const res = await fetch(`${appConfig.nominatimBaseUrl}/search?format=json&addressdetails=1&accept-language=th&q=${encodeURIComponent(searchQuery)}`);
            const data = await res.json();
            setSearchResults(data);
        } catch (error) {
            console.error('Search failed', error);
        } finally {
            setIsSearching(false);
        }
    };

    const handleSearchResultSelect = (result) => {
        const location = result.address || {};
        setForm(prev => ({
            ...prev,
            latitude: parseFloat(result.lat).toFixed(6),
            longitude: parseFloat(result.lon).toFixed(6),
            address: [location.house_number, location.road].filter(Boolean).join(' ') || prev.address,
            province: location.state || location.province || prev.province,
            district: location.county || location.city_district || location.city || prev.district,
            sub_district: location.suburb || location.town || location.village || prev.sub_district,
            postcode: location.postcode || prev.postcode,
        }));
        setSearchResults([]);
        setSearchQuery('');
    };

    // -----------------------
    // Image Upload
    // -----------------------
    const uploadFiles = useCallback(async (files) => {
        if (files.length === 0) return;
        setUploading(true);
        try {
            const formData = new FormData();
            Array.from(files).forEach(f => formData.append('images', f));

            const res = await api.post('/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });

            if (res.data.urls) {
                setImages(prev => [...prev, ...res.data.urls]);
            }
        } catch (err) {
            console.error('Upload error:', err);
            await showErrorAlert('อัปโหลดไม่สำเร็จ');
        }
        setUploading(false);
    }, []);

    const handleFileSelect = (e) => {
        uploadFiles(e.target.files);
        e.target.value = '';
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setDragOver(false);
        const files = e.dataTransfer.files;
        if (files.length > 0) uploadFiles(files);
    };

    const removeImage = (index) => {
        setImages(prev => prev.filter((_, i) => i !== index));
    };

    // -----------------------
    // Submit
    // -----------------------
    const handleSubmit = async () => {
        if (!form.name) {
            await showWarningAlert('กรุณากรอกชื่อสถานที่');
            return;
        }
        setSaving(true);
        try {
            const payload = {
                ...form,
                image_url: images[0] || '',
                images: images,
                admission_fee: {
                    thaiAdult: form.admission_adult,
                    thaiChild: form.admission_child,
                    foreignerAdult: form.admission_foreigner_adult,
                    foreignerChild: form.admission_foreigner_child,
                },
            };
            await api.post('/destinations', payload);
            await showSuccessAlert('เพิ่มสถานที่เรียบร้อยแล้ว');
            navigate('/destinations');
        } catch (err) {
            console.error('เกิดข้อผิดพลาด:', err);
            await showErrorAlert(err.response?.data?.message || 'เกิดข้อผิดพลาด');
        }
        setSaving(false);
    };

    return (
        <div className="w-full space-y-3 p-3">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 bg-gradient-to-r from-gray-900 to-gray-800 p-3 rounded-xl border border-gray-800 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
                <div className="absolute bottom-0 left-10 w-40 h-40 bg-blue-500/5 rounded-full blur-2xl -mb-10 pointer-events-none" />

                <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="px-3 py-1 rounded-full bg-yellow-500/10 text-yellow-500 text-xs font-bold tracking-widest uppercase border border-yellow-500/20">โหมดเพิ่มข้อมูล</span>
                    </div>
                    <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight">
                        เพิ่มสถานที่ใหม่
                    </h1>
                    <p className="text-gray-400 mt-1 text-sm">
                        กรอกข้อมูล ตำแหน่ง และรูปภาพเพื่อสร้างสถานที่ใหม่
                    </p>
                </div>

                <div className="relative z-10 flex items-center gap-2">
                    <button
                        onClick={() => navigate('/destinations')}
                        className="px-4 py-2 bg-white/5 text-white font-bold rounded-xl border border-gray-700"
                    >
                        ยกเลิก
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={saving}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-yellow-500 to-yellow-600 text-black font-bold rounded-xl shadow-[0_0_15px_rgba(234,179,8,0.3)] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                    >
                        {saving ? 'กำลังบันทึก...' : 'เพิ่มสถานที่'}
                    </button>
                </div>
            </div>

            {/* Media Gallery — Multi-image Upload */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 shadow-xl">
                <h2 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
                    <ImagePlus size={24} className="text-yellow-500" />
                    คลังรูปภาพ
                </h2>

                {/* Drag & Drop Zone */}
                <div
                    className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer ${dragOver ? 'border-yellow-500 bg-yellow-500/5' : 'border-gray-700'}`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/gif,image/webp"
                        multiple
                        className="hidden"
                        onChange={handleFileSelect}
                    />
                    {uploading ? (
                        <div className="flex flex-col items-center gap-3">
                            <div className="w-10 h-10 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin" />
                            <p className="text-yellow-500 font-medium animate-pulse">กำลังอัปโหลดไฟล์รูปภาพ...</p>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-2">
                            <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center mb-2">
                                <Upload size={28} className="text-gray-400" />
                            </div>
                            <p className="text-gray-300 font-semibold text-lg">ลากและวาง หรือคลิกเพื่ออัปโหลดรูปภาพ</p>
                            <p className="text-sm text-gray-500">PNG, JPEG, GIF, WebP (ไม่เกิน 10MB ต่อไฟล์ สูงสุด 10 ไฟล์)</p>
                        </div>
                    )}
                </div>

                {/* Image Previews */}
                {images.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 mt-4">
                        {images.map((url, i) => (
                            <div key={i} className="relative aspect-square rounded-xl overflow-hidden shadow-md border border-gray-800">
                                <button
                                    type="button"
                                    onClick={() => setLightboxIndex(i)}
                                    className="w-full h-full cursor-zoom-in block"
                                >
                                    <AuthenticatedImage src={url} alt={`upload-${i}`} className="w-full h-full object-cover" />
                                </button>
                                {i === 0 && (
                                    <span className="absolute top-2 left-2 text-[10px] bg-yellow-500 text-black px-2 py-1 rounded-lg font-bold shadow-sm">
                                        รูปปก
                                    </span>
                                )}
                                <button
                                    type="button"
                                    onClick={() => removeImage(i)}
                                    className="absolute top-2 right-2 bg-red-500/90 text-white p-1.5 rounded-full shadow-lg"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ))}
                        {/* Add more button */}
                        <div
                            className="aspect-square rounded-xl border-2 border-dashed border-gray-700 flex flex-col items-center justify-center text-gray-500 cursor-pointer"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center mb-2">
                                <ImagePlus size={20} className="text-gray-400" />
                            </div>
                            <span className="text-sm font-medium">เพิ่มรูป</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Form */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 shadow-xl">
                <h2 className="text-lg font-bold text-white mb-3 border-b border-gray-800 pb-3">ข้อมูลสถานที่</h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">ชื่อสถานที่</label>
                        <input className="w-full bg-black/40 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/50 focus:border-yellow-500 transition-all" placeholder="กรอกชื่อสถานที่"
                            value={form.name} onChange={e => handleChange('name', e.target.value)} />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">ที่อยู่</label>
                        <input className="w-full bg-black/40 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/50 focus:border-yellow-500 transition-all" placeholder="เช่น 169 ถนนลงหาดบางแสน"
                            value={form.address} onChange={e => handleChange('address', e.target.value)} />
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">จังหวัด</label>
                        <input className="w-full bg-black/40 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/50" placeholder="เช่น ชลบุรี"
                            value={form.province} onChange={e => handleChange('province', e.target.value)} />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">รหัสจังหวัด</label>
                        <input className="w-full bg-black/40 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/50" placeholder="เช่น 464" inputMode="numeric"
                            value={form.province_id} onChange={e => handleChange('province_id', e.target.value)} />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">อำเภอ/เขต</label>
                        <input className="w-full bg-black/40 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/50" placeholder="เช่น เมืองชลบุรี"
                            value={form.district} onChange={e => handleChange('district', e.target.value)} />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">รหัสอำเภอ/เขต</label>
                        <input className="w-full bg-black/40 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/50" placeholder="เช่น 2001" inputMode="numeric"
                            value={form.district_id} onChange={e => handleChange('district_id', e.target.value)} />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">ตำบล/แขวง</label>
                        <input className="w-full bg-black/40 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/50" placeholder="เช่น แสนสุข"
                            value={form.sub_district} onChange={e => handleChange('sub_district', e.target.value)} />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">รหัสตำบล/แขวง</label>
                        <input className="w-full bg-black/40 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/50" placeholder="เช่น 200104" inputMode="numeric"
                            value={form.sub_district_id} onChange={e => handleChange('sub_district_id', e.target.value)} />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">รหัสไปรษณีย์</label>
                        <input className="w-full bg-black/40 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/50" placeholder="เช่น 20000" inputMode="numeric"
                            value={form.postcode} onChange={e => handleChange('postcode', e.target.value)} />
                    </div>
                </div>

                {/* Rich Text Editor */}
                <div className="mb-8">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">รายละเอียด</label>
                    <div className="bg-black/40 border border-gray-700 rounded-xl overflow-hidden [&_.ql-toolbar]:border-none [&_.ql-toolbar]:border-b [&_.ql-toolbar]:border-gray-700 [&_.ql-container]:border-none [&_.ql-editor]:min-h-[160px] [&_.ql-editor]:text-gray-300">
                        <ReactQuill
                            theme="snow"
                            value={form.description}
                            onChange={(val) => handleChange('description', val)}
                            modules={DESTINATION_EDITOR_MODULES}
                            placeholder="กรอกรายละเอียดสถานที่..."
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-4">
                        {/* Coordinates */}
                        <div className="p-4 bg-gray-800/50 rounded-xl border border-gray-700/50">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 block">พิกัดสถานที่</label>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-gray-500 mb-1.5 block font-medium">ละติจูด</label>
                                    <input className="w-full bg-black/40 border border-gray-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/50 font-mono text-sm" type="number" step="any" placeholder="13.7563"
                                        value={form.latitude} onChange={e => handleChange('latitude', e.target.value)} />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 mb-1.5 block font-medium">ลองจิจูด</label>
                                    <input className="w-full bg-black/40 border border-gray-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/50 font-mono text-sm" type="number" step="any" placeholder="100.5018"
                                        value={form.longitude} onChange={e => handleChange('longitude', e.target.value)} />
                                </div>
                            </div>
                        </div>

                        <div className="p-4 bg-gray-800/50 rounded-xl border border-gray-700/50">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 block">ค่าเข้าชม</label>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-gray-500 mb-1.5 block font-medium">ผู้ใหญ่ชาวไทย (บาท)</label>
                                    <input className="w-full bg-black/40 border border-gray-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/50" type="number" min="0" placeholder="เช่น 100"
                                        value={form.admission_adult} onChange={e => handleChange('admission_adult', e.target.value)} />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 mb-1.5 block font-medium">เด็กชาวไทย (บาท)</label>
                                    <input className="w-full bg-black/40 border border-gray-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/50" type="number" min="0" placeholder="เช่น 50"
                                        value={form.admission_child} onChange={e => handleChange('admission_child', e.target.value)} />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 mb-1.5 block font-medium">ผู้ใหญ่ชาวต่างชาติ (บาท)</label>
                                    <input className="w-full bg-black/40 border border-gray-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/50" type="number" min="0" placeholder="เช่น 300"
                                        value={form.admission_foreigner_adult} onChange={e => handleChange('admission_foreigner_adult', e.target.value)} />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 mb-1.5 block font-medium">เด็กชาวต่างชาติ (บาท)</label>
                                    <input className="w-full bg-black/40 border border-gray-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/50" type="number" min="0" placeholder="เช่น 150"
                                        value={form.admission_foreigner_child} onChange={e => handleChange('admission_foreigner_child', e.target.value)} />
                                </div>
                            </div>
                        </div>

                        {/* Status */}
                        <div className="flex flex-col gap-4">
                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">สถานะ</label>
                                <select className="w-full bg-black/40 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/50 appearance-none" value={form.status} onChange={e => handleChange('status', e.target.value)}>
                                    <option value="approved" className="bg-gray-900">อนุมัติแล้ว (เผยแพร่)</option>
                                    <option value="pending" className="bg-gray-900">รออนุมัติ</option>
                                    <option value="rejected" className="bg-gray-900">ไม่อนุมัติ (ซ่อน)</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Leaflet Map & Search */}
                    <div className="relative flex flex-col gap-3">
                        {/* Search Box */}
                        <div className="relative z-[1001]">
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <input
                                        type="text"
                                        placeholder="ค้นหาตำแหน่ง..."
                                        className="w-full bg-black/60 border border-gray-700 rounded-xl pl-10 pr-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/50"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && searchLocation()}
                                    />
                                    <Search size={18} className="absolute left-3.5 top-3.5 text-gray-500" />
                                </div>
                                <button
                                    onClick={searchLocation}
                                    disabled={isSearching}
                                    className="px-5 py-3 bg-gray-800 text-yellow-500 font-bold rounded-xl border border-gray-700 disabled:opacity-50 whitespace-nowrap"
                                >
                                    {isSearching ? 'กำลังค้นหา...' : 'ค้นหา'}
                                </button>
                            </div>

                            {/* Search Results Dropdown */}
                            {searchResults.length > 0 && (
                                <div className="absolute top-full left-0 right-0 mt-2 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-y-auto max-h-60">
                                    {searchResults.map((res, i) => (
                                        <button
                                            key={i}
                                            className="w-full text-left px-4 py-3 border-b border-gray-800 last:border-0 text-sm text-gray-300 flex items-start gap-3"
                                            onClick={() => handleSearchResultSelect(res)}
                                        >
                                            <MapPin size={16} className="text-yellow-500 mt-0.5 shrink-0" />
                                            <span className="truncate">{res.display_name}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Placeholder when map is fixed */}
                        {mapExpanded && <div className="h-full min-h-[220px] rounded-2xl border-2 border-dashed border-gray-700/50 bg-gray-800/20" />}

                        <div className={mapExpanded ? "fixed inset-0 z-[9999] bg-black/90 backdrop-blur-sm p-4 md:p-12 flex flex-col" : "relative group h-full min-h-[220px]"}>
                            {mapExpanded && (
                                <div className="flex justify-between items-center mb-4 text-white">
                                    <h3 className="text-xl font-bold flex items-center gap-2"><MapPin className="text-yellow-500" /> เลือกตำแหน่ง</h3>
                                    <button onClick={() => setMapExpanded(false)} className="bg-gray-800 p-2 rounded-xl">
                                        <X size={24} />
                                    </button>
                                </div>
                            )}
                            {!mapExpanded && (
                                <button
                                    type="button"
                                    onClick={() => setMapExpanded(true)}
                                    className="absolute top-3 right-3 z-[1000] bg-gray-900/90 text-white p-2 rounded-xl shadow-lg border border-gray-700"
                                    title="ขยายแผนที่"
                                >
                                    <Maximize2 size={18} />
                                </button>
                            )}
                            <div className={`rounded-2xl overflow-hidden border border-gray-700 transition-all duration-500 shadow-inner bg-gray-800 w-full h-full relative`}>
                                <MapContainer
                                    center={mapCenter}
                                    zoom={hasValidCoords ? 15 : 6}
                                    style={{ height: '100%', width: '100%', zIndex: 10 }}
                                    scrollWheelZoom={true}
                                >
                                    <TileLayer
                                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                                        url={appConfig.mapTileUrl}
                                    />
                                    <MapClickHandler onLocationSelect={handleLocationSelect} />
                                    <MapResizeTrigger expanded={mapExpanded} />
                                    {hasValidCoords && (
                                        <>
                                            <Marker position={[lat, lng]} />
                                            <MapUpdater lat={lat} lng={lng} />
                                        </>
                                    )}
                                </MapContainer>
                            </div>
                            {!hasValidCoords && !mapExpanded && (
                                <p className="text-xs text-yellow-500 mt-3 text-center flex items-center justify-center gap-1 font-medium bg-yellow-500/10 py-2 rounded-lg">
                                    <span>📍</span> คลิกบนแผนที่เพื่อปักหมุด หรือค้นหาตำแหน่งจากช่องด้านบน
                                </p>
                            )}
                            {hasValidCoords && !mapExpanded && (
                                <p className="text-xs text-gray-500 mt-3 text-center flex items-center justify-center gap-1 bg-gray-800/50 py-2 rounded-lg">
                                    คลิกตำแหน่งอื่นบนแผนที่เพื่อย้ายหมุด
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <ImageLightbox
                images={images}
                currentIndex={lightboxIndex}
                onClose={() => setLightboxIndex(null)}
                onPrevious={() => setLightboxIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1))}
                onNext={() => setLightboxIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1))}
            />
        </div>
    );
};

export default AddDestination;
