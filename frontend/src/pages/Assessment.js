import React, { useState, useEffect } from 'react';
import { Card, Button, Radio, Checkbox, Space, message, Progress, Typography, Spin } from 'antd';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../AuthContext';

const { Title, Paragraph, Text } = Typography;

export default function Assessment() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    checkStatus();
    fetchQuestions();
  }, []);

  const checkStatus = async () => {
    try {
      const res = await axios.get('/api/assessment/status');
      if (res.data.completed) {
        // 静默跳转，不弹出消息
        navigate('/dashboard');
      }
    } catch (err) {
      console.error('检查测评状态失败', err);
    }
  };

  const fetchQuestions = async () => {
    try {
      const res = await axios.get('/api/assessment/questions');
      setQuestions(res.data);
      setLoading(false);
    } catch (err) {
      message.error('获取题目失败，请刷新重试');
      setLoading(false);
    }
  };

  const handleAnswer = (questionId, value) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  const handleSingleChoice = (questionId, e) => {
    handleAnswer(questionId, [e.target.value]);
  };

  const handleMultipleChoice = (questionId, checkedValues) => {
    handleAnswer(questionId, checkedValues);
  };

  const handleSubmit = async () => {
    if (Object.keys(answers).length !== questions.length) {
      message.warning(`请完成所有题目（已完成 ${Object.keys(answers).length}/${questions.length}）`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await axios.post('/api/assessment/submit', { answers });
      message.success(`测评完成！您的专业权重：${res.data.professional_weight}%`);
      navigate('/dashboard');
    } catch (err) {
      message.error(err.response?.data?.detail || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div style={{ padding: 50, textAlign: 'center' }}><Spin size="large" /></div>;
  if (questions.length === 0) return <div style={{ padding: 50, textAlign: 'center' }}>暂无测评题目，请联系管理员配置</div>;

  const currentQuestion = questions[currentIndex];
  const progress = ((currentIndex + 1) / questions.length) * 100;

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
      <Card>
        <Title level={2}>用户专业能力测评</Title>
        <Paragraph>
          请完成以下题目，系统将根据您的专业水平分配评分权重。
          专业用户评分占比更高，普通用户系统评分占比更高。
        </Paragraph>
        <Progress percent={progress} status="active" />
        <div style={{ marginTop: 32, marginBottom: 24 }}>
          <Text strong>第 {currentIndex + 1}/{questions.length} 题</Text>
          <Title level={4}>{currentQuestion.question_text}</Title>
          {currentQuestion.type === 'single' && (
            <Radio.Group onChange={(e) => handleSingleChoice(currentQuestion.id, e)} value={answers[currentQuestion.id]?.[0]}>
              <Space direction="vertical">
                {currentQuestion.options.map(opt => (
                  <Radio key={opt} value={opt.charAt(0)}>{opt}</Radio>
                ))}
              </Space>
            </Radio.Group>
          )}
          {currentQuestion.type === 'multiple' && (
            <Checkbox.Group onChange={(values) => handleMultipleChoice(currentQuestion.id, values)} value={answers[currentQuestion.id] || []}>
              <Space direction="vertical">
                {currentQuestion.options.map(opt => (
                  <Checkbox key={opt} value={opt.charAt(0)}>{opt}</Checkbox>
                ))}
              </Space>
            </Checkbox.Group>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Button disabled={currentIndex === 0} onClick={() => setCurrentIndex(prev => prev - 1)}>上一题</Button>
          {currentIndex === questions.length - 1 ? (
            <Button type="primary" onClick={handleSubmit} loading={submitting}>提交测评</Button>
          ) : (
            <Button type="primary" onClick={() => setCurrentIndex(prev => prev + 1)}>下一题</Button>
          )}
        </div>
      </Card>
    </div>
  );
}