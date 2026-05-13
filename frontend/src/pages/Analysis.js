import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Statistic, Spin, message, Table, Tag, Alert, Button, Space, Modal, Input } from 'antd';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import { EyeOutlined, CopyOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useAuth } from '../AuthContext';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

export default function Analysis() {
  const { user } = useAuth();
  const [overview, setOverview] = useState({ total_evaluated: 0, overall_avg_score: 0 });
  const [trend, setTrend] = useState([]);
  const [models, setModels] = useState([]);
  const [testHistory, setTestHistory] = useState([]);
  const [comparisonData, setComparisonData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [testHistoryLoading, setTestHistoryLoading] = useState(true);

  // 代码预览模态框
  const [codeModalVisible, setCodeModalVisible] = useState(false);
  const [previewCode, setPreviewCode] = useState('');
  const [previewTitle, setPreviewTitle] = useState('');

  useEffect(() => {
    fetchData();
    fetchTestHistory();
  }, [user]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [overviewRes, trendRes, modelRes] = await Promise.all([
        axios.get('/api/analysis/overview'),
        axios.get('/api/analysis/trend'),
        axios.get('/api/analysis/model_comparison')
      ]);
      setOverview(overviewRes.data);
      setTrend(trendRes.data.trend);
      setModels(modelRes.data.models);
    } catch (err) {
      message.error('获取分析数据失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchTestHistory = async () => {
    setTestHistoryLoading(true);
    try {
      const res = await axios.get('/api/test_results', { params: { limit: 200 } });
      const items = res.data.items;
      setTestHistory(items);

      // 计算总体通过率（二值：通过率为100的算通过，否则不通过）
      const validItems = items.filter(t =>
        typeof t.experimental_pass_rate === 'number' &&
        typeof t.baseline_pass_rate === 'number'
      );

      if (validItems.length > 0) {
        // 实验组通过率 = 实验组通过数量 / 总数量 × 100
        const expPassCount = validItems.filter(t => t.experimental_pass_rate === 100).length;
        const basePassCount = validItems.filter(t => t.baseline_pass_rate === 100).length;
        const expAvg = (expPassCount / validItems.length) * 100;
        const baseAvg = (basePassCount / validItems.length) * 100;

        setComparisonData([
          { name: '实验组', 通过率: expAvg },
          { name: '对照组', 通过率: baseAvg },
        ]);
      } else {
        setComparisonData([]);
      }
    } catch (err) {
      console.error('获取测试历史失败', err);
      // 如果接口还未实现，静默失败，显示空数据
      setTestHistory([]);
      setComparisonData([]);
    } finally {
      setTestHistoryLoading(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    message.success('已复制到剪贴板');
  };

  // 查看代码（从会话获取详细代码）
  const viewCode = async (sessionId, type) => {
    try {
      const res = await axios.get(`/api/session/${sessionId}/summary`);
      const code = type === 'experimental' ? res.data.final_code : res.data.baseline_code;
      setPreviewTitle(`${type === 'experimental' ? '实验组' : '对照组'}代码 - ${sessionId.slice(0, 8)}...`);
      setPreviewCode(code || '暂无代码');
      setCodeModalVisible(true);
    } catch (err) {
      message.error('获取代码失败');
    }
  };

  // 表格列定义
  const columns = [
    { 
      title: '会话ID', 
      dataIndex: 'session_id', 
      width: 120,
      ellipsis: true,
      render: (id) => <span title={id}>{id.slice(0, 8)}...</span>
    },
    { 
      title: '需求', 
      dataIndex: 'requirement', 
      ellipsis: true,
      render: (text) => text || '未记录需求'
    },
    {
      title: '实验组（澄清后）',
      dataIndex: 'experimental_passed',
      width: 120,
      align: 'center',
      render: (passed, record) => (
        <Space>
          <Tag color={passed ? 'green' : 'red'}>{passed ? '通过' : '未通过'}</Tag>
          <Button 
            type="link" 
            size="small" 
            icon={<EyeOutlined />}
            onClick={() => viewCode(record.session_id, 'experimental')}
          >
            查看代码
          </Button>
        </Space>
      )
    },
    {
      title: '对照组（直接生成）',
      dataIndex: 'baseline_passed',
      width: 120,
      align: 'center',
      render: (passed, record) => (
        <Space>
          <Tag color={passed ? 'green' : 'red'}>{passed ? '通过' : '未通过'}</Tag>
          <Button 
            type="link" 
            size="small" 
            icon={<EyeOutlined />}
            onClick={() => viewCode(record.session_id, 'baseline')}
          >
            查看代码
          </Button>
        </Space>
      )
    },
  ];

  // 计算统计卡片数据
  const validHistory = testHistory.filter(t => 
    typeof t.experimental_pass_rate === 'number' && 
    typeof t.baseline_pass_rate === 'number'
  );
  const expPassCount = validHistory.filter(t => t.experimental_pass_rate === 100).length;
  const basePassCount = validHistory.filter(t => t.baseline_pass_rate === 100).length;
  const expPassRate = validHistory.length > 0 ? (expPassCount / validHistory.length) * 100 : 0;
  const basePassRate = validHistory.length > 0 ? (basePassCount / validHistory.length) * 100 : 0;

  if (loading) return <div style={{ padding: 24, textAlign: 'center' }}>加载分析数据...</div>;

  return (
    <div style={{ padding: 24 }}>
      <Row gutter={[16, 16]}>
        <Col span={12}>
          <Card title="记录分析">
            <Row gutter={16}>
              <Col span={12}>
                <Statistic title="已评估记录" value={overview.total_evaluated} />
              </Col>
              <Col span={12}>
                <Statistic title="整体平均分" value={overview.overall_avg_score} suffix="分" />
              </Col>
            </Row>
          </Card>
        </Col>
        <Col span={12}>
          <Card title="评分趋势（最近10次）">
            {trend.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="round" label={{ value: '评估轮次', position: 'insideBottom', offset: -5 }} />
                  <YAxis domain={[0, 100]} label={{ value: '分数', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="score" stroke="#8884d8" name="评分" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ textAlign: 'center', padding: 50 }}>暂无评分记录</div>
            )}
          </Card>
        </Col>
      </Row>

      <Row style={{ marginTop: 24 }}>
        <Col span={24}>
          <Card title="各模型平均分对比">
            {models.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={models}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="model" />
                  <YAxis domain={[0, 100]} label={{ value: '平均分', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="score" fill="#82ca9d" name="平均分" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ textAlign: 'center', padding: 50 }}>暂无模型评分数据</div>
            )}
          </Card>
        </Col>
      </Row>

      <Row style={{ marginTop: 24 }}>
        <Col span={24}>
          <Card 
            title="需求澄清效果对比（代码测试结果）" 
            extra={
              <Button onClick={fetchTestHistory} loading={testHistoryLoading} size="small">
                刷新数据
              </Button>
            }
          >
            <Alert
              message="说明"
              description="测试通过率已改为二值判定：所有测试用例都通过为「通过」，否则为「未通过」。总体通过率 = 通过会话数 / 总会话数 × 100%。"
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
            
            {testHistoryLoading ? (
              <div style={{ textAlign: 'center', padding: 50 }}>
                <Spin tip="加载测试历史..." />
              </div>
            ) : testHistory.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 50, color: '#999' }}>
                暂无测试记录，请先在「需求澄清助手」中生成代码并点击「一键测试」。
              </div>
            ) : (
              <>
                <Row gutter={16} style={{ marginBottom: 24 }}>
                  <Col span={12}>
                    <Statistic 
                      title="实验组总体通过率" 
                      value={expPassRate.toFixed(1)} 
                      suffix="%" 
                      valueStyle={{ color: expPassRate >= 60 ? '#3f8600' : '#cf1322' }}
                    />
                    <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
                      通过会话数: {expPassCount} / {validHistory.length}
                    </div>
                  </Col>
                  <Col span={12}>
                    <Statistic 
                      title="对照组总体通过率" 
                      value={basePassRate.toFixed(1)} 
                      suffix="%" 
                      valueStyle={{ color: basePassRate >= 60 ? '#3f8600' : '#cf1322' }}
                    />
                    <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
                      通过会话数: {basePassCount} / {validHistory.length}
                    </div>
                  </Col>
                </Row>
                
                {comparisonData.length > 0 && (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={comparisonData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis domain={[0, 100]} label={{ value: '通过率 (%)', angle: -90, position: 'insideLeft' }} />
                      <Tooltip formatter={(value) => `${value.toFixed(1)}%`} />
                      <Legend />
                      <Bar dataKey="通过率" fill="#52c41a" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
                
                <Table
                  dataSource={testHistory}
                  columns={columns}
                  rowKey="id"
                  pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `共 ${total} 条记录` }}
                  style={{ marginTop: 24 }}
                  scroll={{ x: 900 }}
                />
              </>
            )}
          </Card>
        </Col>
      </Row>

      {/* 代码预览模态框 */}
      <Modal
        title={previewTitle}
        open={codeModalVisible}
        onCancel={() => setCodeModalVisible(false)}
        footer={[
          <Button key="copy" icon={<CopyOutlined />} onClick={() => copyToClipboard(previewCode)}>
            复制代码
          </Button>,
          <Button key="close" type="primary" onClick={() => setCodeModalVisible(false)}>
            关闭
          </Button>
        ]}
        width={900}
      >
        {previewCode ? (
          <div style={{ maxHeight: 500, overflow: 'auto' }}>
            <SyntaxHighlighter language="python" style={vscDarkPlus} showLineNumbers>
              {previewCode}
            </SyntaxHighlighter>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 50, color: '#999' }}>暂无代码</div>
        )}
      </Modal>
    </div>
  );
}