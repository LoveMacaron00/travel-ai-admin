import { useEffect, useState } from 'react';
import { Users, Shield, MessageSquare, Ban, Check, X } from 'lucide-react';
import api from '../utils/api';

const UserManager = () => {
    const [users, setUsers] = useState([]);
    const [feedbacks, setFeedbacks] = useState([]);
    const [replyingTo, setReplyingTo] = useState(null);
    const [replyText, setReplyText] = useState('');

    const fetchUsers = async () => {
        try {
            const res = await api.get('/users');
            setUsers(res.data);
        } catch (err) {
            console.error('Error fetching users:', err);
        }
    }

    const fetchFeedbacks = async () => {
        try {
            const res = await api.get('/feedback');
            setFeedbacks(res.data);
        } catch (err) {
            console.error('Error fetching feedbacks:', err);
        }
    }

    useEffect(() => {
        fetchUsers();
        fetchFeedbacks();
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
        <div className="p-6">

            {/* HEADER */}
            <div className="mb-6">
                <p className="text-sm text-gray-500">Homiie; User Management</p>
                <h1 className="text-2xl font-bold text-yellow-400">
                    User Manager
                </h1>
                <p className="text-gray-400 text-sm mt-1">
                    Manage user access and review feedback
                </p>
            </div>

            {/* STAT CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">

                <div className="card">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 rounded-lg bg-blue-500/20">
                            <Users size={22} className="text-blue-400" />
                        </div>
                    </div>
                    <p className="text-sm text-gray-400">Total Users</p>
                    <p className="text-3xl font-bold mt-1">{users.length}</p>
                </div>

                <div className="card">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 rounded-lg bg-yellow-500/20">
                            <Shield size={22} className="text-yellow-400" />
                        </div>
                    </div>
                    <p className="text-sm text-gray-400">Banned Users</p>
                    <p className="text-3xl font-bold mt-1">
                        {users.filter(u => u.is_banned).length}
                    </p>
                </div>

                <div className="card">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 rounded-lg bg-green-500/20">
                            <MessageSquare size={22} className="text-green-400" />
                        </div>
                    </div>
                    <p className="text-sm text-gray-400">Feedback Received</p>
                    <p className="text-3xl font-bold mt-1">{feedbacks.length}</p>
                </div>
            </div>

            {/* USER TABLE */}
            <div className="card mb-6">
                <h2 className="text-lg font-semibold mb-4">All Users</h2>

                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="text-sm text-gray-400 border-b border-gray-700">
                            <tr>
                                <th className="py-3">Name</th>
                                <th>Email</th>
                                <th>Status</th>
                                <th className="text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map((user) => (
                                <tr
                                    key={user.id}
                                    className="border-b border-gray-800 hover:bg-white/5 transition"
                                >
                                    <td className="py-4 font-medium">
                                        {user.username || 'Unknown'}
                                    </td>
                                    <td className="text-gray-400">
                                        {user.email}
                                    </td>
                                    <td>
                                        <span
                                            className={`px-3 py-1 text-xs rounded-full ${user.is_banned
                                                ? 'bg-red-500/20 text-red-400'
                                                : 'bg-green-500/20 text-green-400'
                                                }`}
                                        >
                                            {user.is_banned ? 'Banned' : 'Active'}
                                        </span>
                                    </td>
                                    <td className="text-right">
                                        {user.is_banned ? (
                                            <span className="text-gray-500 text-sm">Banned</span>
                                        ) : (
                                            <button
                                                onClick={() => handleBan(user.id)}
                                                className="text-red-400 hover:underline text-sm flex items-center gap-1 justify-end"
                                            >
                                                <Ban size={14} />
                                                Ban
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
            <div className="card">
                <h2 className="text-lg font-semibold mb-4">
                    User Feedback
                </h2>

                <div className="space-y-4">
                    {feedbacks.map((fb) => (
                        <div
                            key={fb.id}
                            className="p-4 rounded-lg bg-white/5 border border-gray-800"
                        >
                            <div className="flex justify-between items-start mb-2">
                                <div>
                                    <span className="font-medium">
                                        {fb.username || 'Unknown User'}
                                    </span>
                                    <span className="text-gray-500 text-sm ml-2">
                                        ({fb.user_email})
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`text-xs px-2 py-1 rounded-full ${fb.status === 'replied'
                                        ? 'bg-blue-500/20 text-blue-400'
                                        : 'bg-yellow-500/20 text-yellow-400'
                                        }`}>
                                        {fb.status === 'replied' ? 'Replied' : 'Pending'}
                                    </span>
                                    <span className="text-xs text-gray-500">
                                        {new Date(fb.created_at).toLocaleDateString()}
                                    </span>
                                </div>
                            </div>
                            <p className="text-gray-300 text-sm mb-2">
                                {fb.message}
                            </p>
                            {fb.admin_reply && (
                                <div className="pl-3 border-l-2 border-blue-500/50 mt-2">
                                    <p className="text-xs text-gray-500 mb-1">Admin reply:</p>
                                    <p className="text-gray-400 text-sm">{fb.admin_reply}</p>
                                </div>
                            )}
                            {replyingTo === fb.id ? (
                                <div className="mt-3">
                                    <textarea
                                        value={replyText}
                                        onChange={(e) => setReplyText(e.target.value)}
                                        placeholder="Write your reply..."
                                        className="w-full p-2 bg-gray-800 border border-gray-700 rounded text-sm text-white mb-2"
                                        rows={2}
                                    />
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleReply(fb.id)}
                                            className="flex items-center gap-1 px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
                                        >
                                            <Check size={14} />
                                            Send
                                        </button>
                                        <button
                                            onClick={() => { setReplyingTo(null); setReplyText(''); }}
                                            className="flex items-center gap-1 px-3 py-1 bg-gray-700 text-gray-300 rounded text-sm hover:bg-gray-600"
                                        >
                                            <X size={14} />
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                fb.status !== 'replied' && (
                                    <button
                                        onClick={() => setReplyingTo(fb.id)}
                                        className="mt-2 text-blue-400 hover:underline text-sm"
                                    >
                                        Reply
                                    </button>
                                )
                            )}
                        </div>
                    ))}
                    {feedbacks.length === 0 && (
                        <p className="text-gray-500 text-center py-4">No feedback yet</p>
                    )}
                </div>
            </div>

        </div>
    );
};

export default UserManager;
