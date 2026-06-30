import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, X, Maximize2, Minimize2, ImagePlus, Search, MapPin } from 'lucide-react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import 'leaflet/dist/leaflet.css';
import api from '../utils/api';
import { showErrorAlert, showSuccessAlert, showWarningAlert } from '../utils/alerts';
import ImageLightbox from '../components/ImageLightbox';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const PROVINCES = [
    'Bangkok', 'Chiang Mai', 'Chiang Rai', 'Phuket', 'Krabi', 'Ayutthaya',
    'Kanchanaburi', 'Nakhon Ratchasima', 'Chonburi', 'Surat Thani',
    'Nonthaburi', 'Udon Thani', 'Khon Kaen', 'Songkhla', 'Phang Nga',
    'Sukhothai', 'Nan', 'Lampang', 'Mae Hong Son', 'Tak'
];

const QUILL_MODULES = {
    toolbar: [
        [{ header: [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['link'],
        ['clean']
    ]
};

// Component to recenter map when lat/lng changes
const MapUpdater = ({ lat, lng }) => {
    const map = useMap();
    if (lat && lng) map.setView([lat, lng], map.getZoom());
    return null;
};

// Trigger map resize when container size changes
const MapResizeTrigger = ({ expanded }) => {
    const map = useMap();
    useEffect(() => {
        const t = setTimeout(() => map.invalidateSize(), 300);
        return () => clearTimeout(t);
    }, [map, expanded]);
    return null;
};

// Component to handle map clicks
const MapClickHandler = ({ onLocationSelect }) => {
    useMapEvents({
        click(e) {
            onLocationSelect(e.latlng.lat, e.latlng.lng);
        },
    });
    return null;
};

const AddDestination = () => {
    const navigate = useNavigate();
    const fileInputRef = useRef(null);

    const [form, setForm] = useState({
        name: '', province: '', description: '',
        latitude: '', longitude: '',
        opening_time: '09:00', closing_time: '17:00',
        status: 'approved'
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
    const [hasOpeningHours, setHasOpeningHours] = useState(false);

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
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`);
            const data = await res.json();
            setSearchResults(data);
        } catch (error) {
            console.error('Search failed', error);
        } finally {
            setIsSearching(false);
        }
    };

    const handleSearchResultSelect = (result) => {
        handleLocationSelect(parseFloat(result.lat), parseFloat(result.lon));
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
                opening_time: hasOpeningHours ? form.opening_time : null,
                closing_time: hasOpeningHours ? form.closing_time : null,
                image_url: images[0] || '',
                images: images
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
        <div className="p-6 max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 bg-gradient-to-r from-gray-900 to-gray-800 p-8 rounded-3xl border border-gray-800 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
                <div className="absolute bottom-0 left-10 w-40 h-40 bg-blue-500/5 rounded-full blur-2xl -mb-10 pointer-events-none" />

                <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-3">
                        <span className="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-bold tracking-widest uppercase border border-emerald-500/20">Add Mode</span>
                    </div>
                    <h1 className="text-3xl font-extrabold text-white tracking-tight">
                        Add New Destination
                    </h1>
                    <p className="text-gray-400 mt-2 text-sm">
                        Create a new destination by filling in the information, location, and images
                    </p>
                </div>
                
                <div className="relative z-10 flex items-center gap-4">
                    <button 
                        onClick={() => navigate('/destinations')} 
                        className="px-6 py-3 bg-white/5 hover:bg-white/10 text-white font-bold rounded-xl transition-all border border-gray-700 hover:border-gray-600"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={handleSubmit} 
                        disabled={saving} 
                        className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-black font-bold rounded-xl transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:shadow-[0_0_25px_rgba(16,185,129,0.5)] transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
                    >
                        {saving ? 'กำลังบันทึก...' : 'Add Destination'}
                    </button>
                </div>
            </div>

            {/* Media Gallery — Multi-image Upload */}
            <div className="bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-xl">
                <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-3">
                    <ImagePlus size={24} className="text-emerald-500" />
                    Media Gallery
                </h2>

                {/* Drag & Drop Zone */}
                <div
                    className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all duration-300 ${dragOver ? 'border-emerald-500 bg-emerald-500/5 scale-[1.02]' : 'border-gray-700 hover:border-gray-500 hover:bg-white/[0.02]'}`}
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
                        <div className="flex flex-col items-center gap-4">
                            <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                            <p className="text-emerald-500 font-medium animate-pulse">กำลังอัปโหลดไฟล์รูปภาพ...</p>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-2">
                            <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                                <Upload size={28} className="text-gray-400" />
                            </div>
                            <p className="text-gray-300 font-semibold text-lg">Drag & Drop or Click to upload images</p>
                            <p className="text-sm text-gray-500">PNG, JPEG, GIF, WebP (max 10MB each, up to 10 files)</p>
                        </div>
                    )}
                </div>

                {/* Image Previews */}
                {images.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 mt-8">
                        {images.map((url, i) => (
                            <div key={i} className="relative group aspect-square rounded-2xl overflow-hidden shadow-md border border-gray-800">
                                <button
                                    type="button"
                                    onClick={() => setLightboxIndex(i)}
                                    className="w-full h-full cursor-zoom-in block"
                                >
                                    <img src={url} alt={`upload-${i}`} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                                </button>
                                {i === 0 && (
                                    <span className="absolute top-2 left-2 text-[10px] bg-emerald-500 text-black px-2 py-1 rounded-lg font-bold shadow-sm">
                                        COVER
                                    </span>
                                )}
                                <button
                                    type="button"
                                    onClick={() => removeImage(i)}
                                    className="absolute top-2 right-2 bg-red-500/90 hover:bg-red-600 text-white p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-all transform hover:scale-110 shadow-lg"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ))}
                        {/* Add more button */}
                        <div
                            className="aspect-square rounded-2xl border-2 border-dashed border-gray-700 flex flex-col items-center justify-center text-gray-500 cursor-pointer hover:border-gray-500 hover:bg-white/[0.02] transition-all group"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center mb-2 group-hover:bg-gray-700 transition-colors">
                                <ImagePlus size={20} className="text-gray-400 group-hover:text-white transition-colors" />
                            </div>
                            <span className="text-sm font-medium group-hover:text-gray-300 transition-colors">Add more</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Form */}
            <div className="bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-xl">
                <h2 className="text-xl font-bold text-white mb-6 border-b border-gray-800 pb-4">Destination Information</h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">Destination Name</label>
                        <input className="w-full bg-black/40 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all" placeholder="Enter destination name"
                            value={form.name} onChange={e => handleChange('name', e.target.value)} />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">Province</label>
                        <select className="w-full bg-black/40 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all appearance-none" value={form.province} onChange={e => handleChange('province', e.target.value)}>
                            <option value="" className="bg-gray-900 text-gray-400">Select Province</option>
                            {PROVINCES.map(p => <option key={p} value={p} className="bg-gray-900">{p}</option>)}
                        </select>
                    </div>
                </div>

                {/* Rich Text Editor */}
                <div className="mb-8">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">Description</label>
                    <div className="bg-black/40 border border-gray-700 rounded-xl overflow-hidden [&_.ql-toolbar]:border-none [&_.ql-toolbar]:border-b [&_.ql-toolbar]:border-gray-700 [&_.ql-container]:border-none [&_.ql-editor]:min-h-[200px] [&_.ql-editor]:text-gray-300">
                        <ReactQuill
                            theme="snow"
                            value={form.description}
                            onChange={(val) => handleChange('description', val)}
                            modules={QUILL_MODULES}
                            placeholder="Enter detailed description here..."
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-6">
                        {/* Coordinates */}
                        <div className="p-5 bg-gray-800/50 rounded-2xl border border-gray-700/50">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 block">Location Coordinates</label>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-gray-500 mb-1.5 block font-medium">Latitude</label>
                                    <input className="w-full bg-black/40 border border-gray-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 font-mono text-sm" type="number" step="any" placeholder="13.7563"
                                        value={form.latitude} onChange={e => handleChange('latitude', e.target.value)} />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 mb-1.5 block font-medium">Longitude</label>
                                    <input className="w-full bg-black/40 border border-gray-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 font-mono text-sm" type="number" step="any" placeholder="100.5018"
                                        value={form.longitude} onChange={e => handleChange('longitude', e.target.value)} />
                                </div>
                            </div>
                        </div>

                        {/* Time & Status */}
                        <div className="flex flex-col gap-6">
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">Opening Hours</label>
                                    <label className="flex items-center gap-2 cursor-pointer group">
                                        <input 
                                            type="checkbox" 
                                            className="w-4 h-4 rounded bg-black/40 border border-gray-700 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-gray-900" 
                                            checked={hasOpeningHours}
                                            onChange={(e) => setHasOpeningHours(e.target.checked)}
                                        />
                                        <span className="text-xs text-gray-400 group-hover:text-emerald-400 transition-colors">Specify hours</span>
                                    </label>
                                </div>
                                {hasOpeningHours ? (
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="time"
                                            className="w-full bg-black/40 border border-gray-700 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                            value={form.opening_time}
                                            onChange={e => handleChange('opening_time', e.target.value)}
                                        />
                                        <span className="text-gray-500 font-medium">-</span>
                                        <input
                                            type="time"
                                            className="w-full bg-black/40 border border-gray-700 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                            value={form.closing_time}
                                            onChange={e => handleChange('closing_time', e.target.value)}
                                        />
                                    </div>
                                ) : (
                                    <div className="bg-black/20 border border-gray-800 rounded-xl px-4 py-2.5 text-gray-500 text-sm flex items-center justify-center h-[46px]">
                                        No opening hours specified
                                    </div>
                                )}
                            </div>

                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">Status</label>
                                <select className="w-full bg-black/40 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 appearance-none" value={form.status} onChange={e => handleChange('status', e.target.value)}>
                                    <option value="approved" className="bg-gray-900">Approved (Public)</option>
                                    <option value="pending" className="bg-gray-900">Pending (Waiting)</option>
                                    <option value="rejected" className="bg-gray-900">Rejected (Hidden)</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Leaflet Map & Search */}
                    <div className="relative flex flex-col gap-4">
                        {/* Search Box */}
                        <div className="relative z-[1001]">
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <input 
                                        type="text" 
                                        placeholder="Search location (Free service)..." 
                                        className="w-full bg-black/60 border border-gray-700 rounded-xl pl-10 pr-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && searchLocation()}
                                    />
                                    <Search size={18} className="absolute left-3.5 top-3.5 text-gray-500" />
                                </div>
                                <button 
                                    onClick={searchLocation}
                                    disabled={isSearching}
                                    className="px-5 py-3 bg-gray-800 hover:bg-gray-700 text-emerald-400 font-bold rounded-xl transition-all border border-gray-700 disabled:opacity-50 whitespace-nowrap"
                                >
                                    {isSearching ? 'Searching...' : 'Search'}
                                </button>
                            </div>
                            
                            {/* Search Results Dropdown */}
                            {searchResults.length > 0 && (
                                <div className="absolute top-full left-0 right-0 mt-2 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-y-auto max-h-60">
                                    {searchResults.map((res, i) => (
                                        <button
                                            key={i}
                                            className="w-full text-left px-4 py-3 hover:bg-gray-800 border-b border-gray-800 last:border-0 text-sm text-gray-300 transition-colors flex items-start gap-3"
                                            onClick={() => handleSearchResultSelect(res)}
                                        >
                                            <MapPin size={16} className="text-emerald-500 mt-0.5 shrink-0" />
                                            <span className="truncate">{res.display_name}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Placeholder when map is fixed */}
                        {mapExpanded && <div className="h-full min-h-[250px] rounded-2xl border-2 border-dashed border-gray-700/50 bg-gray-800/20" />}
                        
                        <div className={mapExpanded ? "fixed inset-0 z-[9999] bg-black/90 backdrop-blur-sm p-4 md:p-12 flex flex-col" : "relative group h-full min-h-[250px]"}>
                            {mapExpanded && (
                                <div className="flex justify-between items-center mb-4 text-white">
                                    <h3 className="text-xl font-bold flex items-center gap-2"><MapPin className="text-emerald-500" /> Select Location</h3>
                                    <button onClick={() => setMapExpanded(false)} className="bg-gray-800 hover:bg-gray-700 p-2 rounded-xl transition-colors">
                                        <X size={24} />
                                    </button>
                                </div>
                            )}
                            {!mapExpanded && (
                                <button
                                    type="button"
                                    onClick={() => setMapExpanded(true)}
                                    className="absolute top-3 right-3 z-[1000] bg-gray-900/90 text-white p-2 rounded-xl hover:bg-gray-800 transition-all shadow-lg border border-gray-700"
                                    title="Expand Map"
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
                                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
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
                                <p className="text-xs text-emerald-500 mt-3 text-center flex items-center justify-center gap-1 font-medium bg-emerald-500/10 py-2 rounded-lg">
                                    <span>📍</span> Click anywhere on the map to drop a pin, or use the search above.
                                </p>
                            )}
                            {hasValidCoords && !mapExpanded && (
                                <p className="text-xs text-gray-500 mt-3 text-center flex items-center justify-center gap-1 bg-gray-800/50 py-2 rounded-lg">
                                    Click anywhere else on the map to move the pin.
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
