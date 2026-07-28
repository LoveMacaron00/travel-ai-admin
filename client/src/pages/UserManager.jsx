import { useEffect, useMemo, useState } from 'react';
import { Users, Shield, MessageSquare, Ban, Check, Search, RefreshCw } from 'lucide-react';
import api from '../utils/api';

const UserManager = () => {
    const [users, setUsers] = useState([]);
    const [feedbacks, setFeedbacks] = useState([]);
    const [replyingTo, setReplyingTo] = useState(null);
    const [replyText, setReplyText] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');

    const filteredUsers = useMemo(() => {
        const query = searchQuery.trim().toLocaleLowerCase('th');
        if (!query) return users;

        return users.filter((user) => [user.username, user.email]
            .some((value) => String(value || '').toLocaleLowerCase('th').includes(query)));
    }, [searchQuery, users]);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const [usersRes, feedbackRes] = await Promise.all([
                api.get('/users'),
                api.get('/feedback')
            ]);
            setUsers(usersRes.data || []);
            setFeedbacks(feedbackRes.data || []);
        } catch (err) {
            console.error('Error fetching data:', err);
        } finally {
            setIsLoading(false);
        }
    }

    useEffect(() => {
        fetchData();
    }, []);

    const handleBan = async (id) => {
        try {
            const res = await api.put(`/users/${id}/ban`);
            const updatedUser = res.data;
            setUsers(prev =>
                prev.map(user =>
                    user.id === updatedUser.id
                        ? { ...user, is_banned: updatedUser.is_banned }
                        : user
                )
            );
        } catch (err) {
            console.error('Error banning user:', err);
        }
    };

    const handleReply = async (id) => {
        if (!replyText.trim()) return;
        try {
            const res = await api.put(`/feedback/${id}`, {
                status: 'replied',
                admin_reply: replyText
            });
            const updatedFeedback = res.data;
            setFeedbacks(prev =>
                prev.map(fb =>
                    fb.id === updatedFeedback.id
                        ? { ...fb, status: 'replied', admin_reply: replyText }
                        : fb
                )
            );
            setReplyingTo(null);
            setReplyText('');
        } catch (err) {
            console.error('Error replying:', err);
        }
    };

    return (
        <div className="w-full space-y-3 p-3">

            {/* HEADER */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 bg-gradient-to-r from-gray-900 to-gray-800 p-3 rounded-xl border border-gray-800 shadow-xl relative overflow-hidden">
                {/* Decorative background element */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />

                <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="px-3 py-1 rounded-full bg-yellow-500/10 text-yellow-500 text-xs font-bold tracking-widest uppercase">ผู้ดูแลระบบ Homiie</span>
                    </div>
                    <h1 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
                        จัดการผู้ใช้งาน
                    </h1>
                    <p className="text-gray-400 mt-1 text-sm max-w-xl leading-relaxed">
                        ตรวจสอบกิจกรรม จัดการสิทธิ์การใช้งาน และตอบกลับความคิดเห็นของผู้ใช้ในที่เดียว
                    </p>
                </div>

                <button
                    onClick={fetchData}
                    disabled={isLoading}
                    className="relative z-10 flex items-center gap-2 px-4 py-2 bg-white/5 border border-gray-700 rounded-xl text-sm font-medium text-gray-300 disabled:opacity-50"
                >
                    <RefreshCw size={16} className={isLoading ? "text-yellow-400" : "text-yellow-400"} />
                    รีเฟรชข้อมูล
                </button>
            </div>

            {/* STAT CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 shadow-lg group relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-[0.03]">
                        <Users size={40} className="text-blue-500" />
                    </div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20 shadow-[0_0_20px_rgba(59,130,246,0.1)]">
                            <Users size={16} />
                        </div>
                        <p className="font-semibold text-gray-400">ผู้ใช้ทั้งหมด</p>
                    </div>
                    <div className="flex items-baseline gap-3">
                        <p className="text-xl md:text-2xl font-extrabold text-white tracking-tight">{users.length}</p>
                    </div>
                </div>

                <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 shadow-lg group relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-[0.03]">
                        <Shield size={40} className="text-red-500" />
                    </div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 rounded-lg bg-red-500/10 text-red-400 ring-1 ring-red-500/20 shadow-[0_0_20px_rgba(239,68,68,0.1)]">
                            <Shield size={16} />
                        </div>
                        <p className="font-semibold text-gray-400">ถูกระงับ</p>
                    </div>
                    <div className="flex items-baseline gap-3">
                        <p className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
                            {users.filter(u => u.is_banned).length}
                        </p>
                    </div>
                </div>

                <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 shadow-lg group relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-[0.03]">
                        <MessageSquare size={40} className="text-emerald-500" />
                    </div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.1)]">
                            <MessageSquare size={16} />
                        </div>
                        <p className="font-semibold text-gray-400">ความคิดเห็น</p>
                    </div>
                    <div className="flex items-baseline gap-3">
                        <p className="text-xl md:text-2xl font-extrabold text-white tracking-tight">{feedbacks.length}</p>
                        <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-md">
                            รอตอบ {feedbacks.filter(f => f.status !== 'replied').length} รายการ
                        </span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                {/* USER TABLE */}
                <div className="xl:col-span-2 bg-gray-900 border border-gray-800 rounded-xl shadow-xl overflow-hidden flex flex-col h-[420px] xl:h-[calc(100vh-300px)] xl:min-h-[360px] xl:max-h-[560px]">
                    <div className="flex flex-col gap-3 border-b border-gray-800 bg-gray-900/80 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                            <h2 className="text-xl font-bold text-white">รายชื่อผู้ใช้งาน</h2>
                            <p className="text-sm text-gray-500 mt-1">จัดการบัญชีและสถานะผู้ใช้งาน</p>
                        </div>
                        <div className="relative w-full sm:w-64 sm:shrink-0">
                            <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                            <input
                                type="text"
                                placeholder="ค้นหาผู้ใช้งาน..."
                                value={searchQuery}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                className="w-full rounded-xl border border-gray-800 bg-black/40 py-2.5 pl-10 pr-4 text-sm text-white shadow-inner outline-none focus:border-yellow-500/50 focus:ring-2 focus:ring-yellow-500/50"
                            />
                        </div>
                    </div>

                    <div className="overflow-y-auto flex-1 p-0 custom-scrollbar bg-gray-900/30">
                        <table className="w-full text-left border-collapse">
                            <thead className="sticky top-0 bg-gray-900/95 backdrop-blur-md text-xs text-gray-500 font-semibold uppercase tracking-wider z-10 shadow-sm border-b border-gray-800">
                                <tr>
                                    <th className="py-2.5 px-3">ข้อมูลผู้ใช้</th>
                                    <th className="py-2.5 px-3">สถานะ</th>
                                    <th className="py-2.5 px-3 text-right">การจัดการ</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-800/50">
                                {filteredUsers.length === 0 && !isLoading ? (
                                    <tr>
                                        <td colSpan="3" className="py-16 text-center text-gray-500">
                                            {searchQuery ? 'ไม่พบผู้ใช้งานที่ค้นหา' : 'ไม่พบผู้ใช้งาน'}
                                        </td>
                                    </tr>
                                ) : filteredUsers.map((user) => (
                                    <tr
                                        key={user.id}
                                        className=" group"
                                    >
                                        <td className="py-2 px-3">
                                            <div className="flex items-center gap-2.5">
                                                <div className="w-7 h-7 text-[10px] rounded-full bg-gradient-to-br from-gray-800 to-gray-700 flex items-center justify-center border border-gray-600 flex-shrink-0 text-white font-bold shadow-inner">
                                                    {(user.username || 'U')[0].toUpperCase()}
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-gray-200">
                                                        {user.username || 'ไม่ทราบชื่อผู้ใช้'}
                                                    </p>
                                                    <p className="text-sm text-gray-500 mt-0.5">
                                                        {user.email}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="py-2 px-3">
                                            <span
                                                className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg border ${user.is_banned
                                                    ? 'bg-red-500/10 text-red-400 border-red-500/20'
                                                    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                                    }`}
                                            >
                                                <span className={`w-1.5 h-1.5 rounded-full ${user.is_banned ? 'bg-red-400' : 'bg-emerald-400'}`}></span>
                                                {user.is_banned ? 'ถูกระงับ' : 'ใช้งานอยู่'}
                                            </span>
                                        </td>
                                        <td className="py-2 px-3 text-right">
                                            {user.is_banned ? (
                                                <span className="inline-flex items-center px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 bg-gray-800/50">
                                                    ระงับแล้ว
                                                </span>
                                            ) : (
                                                <button
                                                    onClick={() => handleBan(user.id)}
                                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-red-400/90 border border-transparent shadow-sm"
                                                >
                                                    <Ban size={15} />
                                                    ระงับผู้ใช้
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* FEEDBACK SECTION */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-xl overflow-hidden flex flex-col h-[420px] xl:h-[calc(100vh-300px)] xl:min-h-[360px] xl:max-h-[560px]">
                    <div className="p-3 border-b border-gray-800 bg-gray-900/80">
                        <div className="flex justify-between items-center mb-1">
                            <h2 className="text-xl font-bold text-white">ความคิดเห็นจากผู้ใช้</h2>
                        </div>
                        <p className="text-sm text-gray-500">ความคิดเห็นและคำถามล่าสุด</p>
                    </div>

                    <div className="overflow-y-auto flex-1 p-3 space-y-3 custom-scrollbar bg-gray-900/30">
                        {feedbacks.length === 0 && !isLoading ? (
                            <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-4">
                                <MessageSquare size={40} className="opacity-20" />
                                <p className="font-medium">ยังไม่มีความคิดเห็น</p>
                            </div>
                        ) : feedbacks.map((fb) => (
                            <div
                                key={fb.id}
                                className="p-3 rounded-lg bg-black/30 border border-gray-800/80 group relative shadow-sm"
                            >
                                <div className="flex justify-between items-start mb-4">
                                    <div className="flex items-center gap-2.5">
                                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gray-800 to-gray-700 flex items-center justify-center text-[10px] font-bold text-gray-300 border border-gray-700">
                                            {(fb.username || 'U')[0].toUpperCase()}
                                        </div>
                                        <div>
                                            <span className="font-semibold text-gray-200 text-sm block">
                                                {fb.username || 'ไม่ทราบชื่อ'}
                                            </span>
                                            <span className="text-gray-500 text-xs font-medium">
                                                {fb.user_email}
                                            </span>
                                        </div>
                                    </div>
                                    <span className={`text-[10px] uppercase tracking-wider font-bold px-2.5 py-1 rounded-md border ${fb.status === 'replied'
                                        ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                                        : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                                        }`}>
                                        {fb.status === 'replied' ? 'ตอบแล้ว' : 'รอตอบ'}
                                    </span>
                                </div>

                                <div className="text-gray-300 text-sm mb-4 leading-relaxed bg-white/[0.03] p-4 rounded-xl border border-white/[0.02]">
                                    {fb.message}
                                </div>

                                {fb.admin_reply && (
                                    <div className="pl-4 border-l-2 border-blue-500/40 mt-4 relative">
                                        <div className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                                        <p className="text-[11px] font-bold text-blue-400 mb-1.5 uppercase tracking-wider">คำตอบจากผู้ดูแลระบบ</p>
                                        <p className="text-gray-400 text-sm bg-blue-500/5 p-3 rounded-xl border border-blue-500/10">{fb.admin_reply}</p>
                                    </div>
                                )}

                                {replyingTo === fb.id ? (
                                    <div className="mt-5">
                                        <textarea
                                            value={replyText}
                                            onChange={(e) => setReplyText(e.target.value)}
                                            placeholder="พิมพ์คำตอบที่นี่..."
                                            className="w-full p-4 bg-gray-900/80 border border-gray-700 focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 rounded-xl text-sm text-gray-200 mb-3 outline-none resize-none shadow-inner"
                                            rows={3}
                                            autoFocus
                                        />
                                        <div className="flex gap-2 justify-end">
                                            <button
                                                onClick={() => { setReplyingTo(null); setReplyText(''); }}
                                                className="px-4 py-2 bg-transparent text-gray-400 hover:text-white rounded-xl text-sm font-semibold"
                                            >
                                                ยกเลิก
                                            </button>
                                            <button
                                                onClick={() => handleReply(fb.id)}
                                                disabled={!replyText.trim()}
                                                className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold shadow-[0_4px_14px_0_rgba(37,99,235,0.39)] hover:shadow-[0_6px_20px_rgba(37,99,235,0.23)] disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed"
                                            >
                                                <Check size={16} />
                                                ส่งคำตอบ
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    fb.status !== 'replied' && (
                                        <button
                                            onClick={() => setReplyingTo(fb.id)}
                                            className="mt-3 flex items-center gap-1.5 text-blue-400 text-sm font-semibold opacity-80"
                                        >
                                            <MessageSquare size={15} />
                                            เขียนคำตอบ
                                        </button>
                                    )
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

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

export default UserManager;
