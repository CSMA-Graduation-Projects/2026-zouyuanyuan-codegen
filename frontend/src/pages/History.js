import React, { useState, useEffect } from 'react';
import { Card, Table, Button, Modal, Descriptions, message, Spin, Popconfirm, Space, Input, InputNumber } from 'antd';
import { EyeOutlined, DownloadOutlined, DeleteOutlined, StarOutlined, EditOutlined, SearchOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useAuth } from '../AuthContext';

export default function History() {
  const { user } = useAuth();  // 添加这一行，从 AuthContext 获取 user
  const [historyList, setHistoryList] = useState([]);
  const [filteredList, setFilteredList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedHistory, setSelectedHistory] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [searchText, setSearchText] = useState('');

  const [scoreEditVisible, setScoreEditVisible] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editingScoreValue, setEditingScoreValue] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchHistory();
  }, [user]);  // 依赖 user，切换用户时重新加载

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/sessions');
      if (res.data && Array.isArray(res.data)) {
        setHistoryList(res.data);
        setFilteredList(res.data);
      } else {
        setHistoryList([]);
        setFilteredList([]);
        message.warning('获取历史会话数据格式异常');
      }
    } catch (err) {
      console.error('获取历史会话失败', err);
      message.error('获取历史会话失败：' + (err.response?.data?.detail || err.message));
      setHistoryList([]);
      setFilteredList([]);
    } finally {
      setLoading(false);
    }
  };

  const viewDetail = async (sessionId) => {
    try {
      const res = await axios.get(`/api/session/${sessionId}/summary`);
      setSelectedHistory(res.data);
      setModalVisible(true);
    } catch (err) {
      message.error('获取会话详情失败：' + (err.response?.data?.detail || err.message));
    }
  };

  const saveCode = (code) => {
    if (!code) return;
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'code.py';
    a.click();
    URL.revokeObjectURL(url);
  };

  const deleteSession = async (sessionId) => {
    try {
      await axios.delete(`/api/session/${sessionId}`);
      message.success('删除成功');
      fetchHistory();
    } catch (err) {
      message.error('删除失败：' + (err.response?.data?.detail || err.message));
    }
  };

  const markAsHighQuality = async (sessionId) => {
    try {
      await axios.post('/api/cases/mark', { session_id: sessionId });
      message.success('已收录到高质量案例库');
    } catch (err) {
      message.error(err.response?.data?.detail || '收录失败');
    }
  };

  const openScoreEdit = (sessionId, currentScore) => {
    setEditingSessionId(sessionId);
    setEditingScoreValue(currentScore !== undefined && currentScore !== null ? currentScore : null);
    setScoreEditVisible(true);
  };

  const handleSaveUserScore = async () => {
    if (editingScoreValue === undefined || editingScoreValue === null) {
      message.error('请输入评分');
      return;
    }
    if (editingScoreValue < 0 || editingScoreValue > 100) {
      message.error('评分应在 0-100 之间');
      return;
    }
    setSubmitting(true);
    try {
      await axios.post('/api/update_user_score', {
        session_id: editingSessionId,
        user_score: editingScoreValue
      });
      message.success('评分更新成功');
      setScoreEditVisible(false);
      await fetchHistory();
    } catch (err) {
      message.error('更新失败：' + (err.response?.data?.detail || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSearch = (value) => {
    setSearchText(value);
    if (!value.trim()) {
      setFilteredList(historyList);
    } else {
      const lowercasedValue = value.toLowerCase();
      const filtered = historyList.filter(item =>
        item.requirement && item.requirement.toLowerCase().includes(lowercasedValue)
      );
      setFilteredList(filtered);
    }
  };

  const columns = [
    { title: '原始需求', dataIndex: 'requirement', ellipsis: true },
    { title: '系统评分', dataIndex: 'auto_score', render: (v) => (v !== null && v !== undefined ? v : '暂无'), align: 'center' },
    {
      title: '用户评分',
      dataIndex: 'user_score',
      align: 'center',
      render: (v, record) => {
        const displayValue = (v !== null && v !== undefined) ? v : '未评分';
        return (
          <Space size="small">
            <span style={{ cursor: 'pointer', color: '#1890ff' }} onClick={() => openScoreEdit(record.session_id, v)}>
              {displayValue}
            </span>
            <EditOutlined style={{ cursor: 'pointer', color: '#1890ff' }} onClick={() => openScoreEdit(record.session_id, v)} />
          </Space>
        );
      }
    },
    {
      title: '操作',
      render: (_, record) => (
        <Space>
          <Button icon={<EyeOutlined />} onClick={() => viewDetail(record.session_id)}>详情</Button>
          <Button icon={<StarOutlined />} onClick={() => markAsHighQuality(record.session_id)}>收录案例</Button>
          <Popconfirm title="确定删除该会话记录？" onConfirm={() => deleteSession(record.session_id)} okText="确定" cancelText="取消">
            <Button icon={<DeleteOutlined />} danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (loading) return <Spin size="large" style={{ margin: 50 }} />;

  return (
    <div style={{ padding: 24 }}>
      <Card title="历史任务追溯" extra={
        <Input.Search
          placeholder="搜索需求内容"
          allowClear
          onSearch={handleSearch}
          style={{ width: 250 }}
          prefix={<SearchOutlined />}
        />
      }>
        {filteredList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 50, color: '#999' }}>
            {searchText ? '没有找到匹配的历史任务' : '暂无历史任务'}
          </div>
        ) : (
          <Table dataSource={filteredList} columns={columns} rowKey="session_id" pagination={{ pageSize: 10 }} />
        )}
      </Card>

      <Modal title="任务详情" open={modalVisible} onCancel={() => setModalVisible(false)} footer={null} width={800}>
        {selectedHistory && (
          <Descriptions column={1} bordered>
            <Descriptions.Item label="原始需求">{selectedHistory.original_requirement}</Descriptions.Item>
            <Descriptions.Item label="对话历史">
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {selectedHistory.conversation_history && selectedHistory.conversation_history.length > 0 ? (
                  selectedHistory.conversation_history.map((msg, idx) => (
                    <div key={idx}><strong>{msg.role}:</strong> {msg.content}</div>
                  ))
                ) : (
                  <span style={{ color: '#999' }}>暂无对话记录</span>
                )}
              </div>
            </Descriptions.Item>
            <Descriptions.Item label="最终代码">
              <pre style={{ background: 'white', color: 'black', maxHeight: 300, overflow: 'auto' }}>
                {selectedHistory.final_code || '未生成'}
              </pre>
              {selectedHistory.final_code && (
                <Button icon={<DownloadOutlined />} onClick={() => saveCode(selectedHistory.final_code)}>保存代码</Button>
              )}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      <Modal
        title="编辑用户评分"
        open={scoreEditVisible}
        onCancel={() => setScoreEditVisible(false)}
        onOk={handleSaveUserScore}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
      >
        <div style={{ marginBottom: 16 }}>
          <p>请输入 0-100 之间的整数评分：</p>
          <InputNumber
            min={0}
            max={100}
            value={editingScoreValue}
            onChange={(val) => setEditingScoreValue(val)}
            style={{ width: '100%' }}
            placeholder="请输入评分"
          />
        </div>
      </Modal>
    </div>
  );
}