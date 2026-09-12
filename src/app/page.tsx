/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

'use client';

import { ChevronRight, ChevronUp, Search, X } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';

// 客户端收藏与播放记录 API 导入
import {
  clearAllFavorites,
  getAllFavorites,
  getAllPlayRecords,
  subscribeToDataUpdates,
  addSearchHistory,
  clearSearchHistory,
  deleteSearchHistory,
  getSearchHistory,
} from '@/lib/db.client';
import { SearchResult, DoubanItem } from '@/lib/types';
import { yellowWords } from '@/lib/yellow';

import CapsuleSwitch from '@/components/CapsuleSwitch';
import ContinueWatching from '@/components/ContinueWatching';
import PageLayout from '@/components/PageLayout';
import { useSite } from '@/components/SiteProvider';
import VideoCard from '@/components/VideoCard';

function HomeClient() {
  const [activeTab, setActiveTab] = useState<'home' | 'favorites'>('home');
  const [loading, setLoading] = useState(false);
  const { announcement } = useSite();
  const [showAnnouncement, setShowAnnouncement] = useState(false);

  // === 完美的同屏搜索核心状态群 ===
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [viewMode, setViewMode] = useState<'agg' | 'all'>('agg');

  // 检查公告弹窗状态
  useEffect(() => {
    if (typeof window !== 'undefined' && announcement) {
      const hasSeenAnnouncement = localStorage.getItem('hasSeenAnnouncement');
      if (hasSeenAnnouncement !== announcement) {
        setShowAnnouncement(true);
      } else {
        setShowAnnouncement(Boolean(!hasSeenAnnouncement && announcement));
      }
    }
  }, [announcement]);

  // 收藏夹状态管理
  type FavoriteItem = {
    id: string;
    source: string;
    title: string;
    poster: string;
    episodes: number;
    source_name: string;
    currentEpisode?: number;
    search_title?: string;
  };
  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);

  // 监听并载入本地搜索历史与滚动条
  useEffect(() => {
    getSearchHistory().then(setSearchHistory);

    const unsubscribeHistory = subscribeToDataUpdates(
      'searchHistoryUpdated',
      (newHistory: string[]) => {
        setSearchHistory(newHistory);
      }
    );

    const handleScroll = () => {
      const scrollTop = document.body.scrollTop || document.documentElement.scrollTop || 0;
      setShowBackToTop(scrollTop > 300);
    };

    document.body.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      unsubscribeHistory();
      document.body.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // 执行 20 个采集站并行网络搜索
  const executeLocalSearch = async (query: string) => {
    const target = query.trim();
    if (!target) return;
    try {
      setIsLoading(true);
      setShowResults(true);
      const response = await fetch(`/api/search?q=${encodeURIComponent(target)}`);
      const data = await response.json();
      let results = data.results || [];

      if (
        typeof window !== 'undefined' &&
        !(window as any).RUNTIME_CONFIG?.DISABLE_YELLOW_FILTER
      ) {
        results = results.filter((result: SearchResult) => {
          const typeName = result.type_name || '';
          return !yellowWords.some((word: string) => typeName.includes(word));
        });
      }

      setSearchResults(
        results.sort((a: SearchResult, b: SearchResult) => {
          const aExactMatch = a.title === target;
          const bExactMatch = b.title === target;
          if (aExactMatch && !bExactMatch) return -1;
          if (!aExactMatch && bExactMatch) return 1;
          if (a.year === b.year) {
            return a.title.localeCompare(b.title);
          } else {
            if (a.year === 'unknown' && b.year === 'unknown') return 0;
            if (a.year === 'unknown') return 1;
            if (b.year === 'unknown') return -1;
            return parseInt(a.year) > parseInt(b.year) ? -1 : 1;
          }
        })
      );
    } catch (error) {
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const onFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim().replace(/\s+/g, ' ');
    if (!trimmed) return;
    executeLocalSearch(trimmed);
    addSearchHistory(trimmed);
  };

  // 严格复制 search 页面 100% 成功的聚合状态处理器
  const aggregatedResults = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    searchResults.forEach((item) => {
      const key = `${item.title.replaceAll(' ', '')}-${
        item.year || 'unknown'
      }-${item.episodes.length === 1 ? 'movie' : 'tv'}`;
      const arr = map.get(key) || [];
      arr.push(item);
      map.set(key, arr);
    });
    return Array.from(map.entries()).sort((a, b) => {
      const aExactMatch = a[1][0].title.replaceAll(' ', '').includes(searchQuery.trim().replaceAll(' ', ''));
      const bExactMatch = b[1][0].title.replaceAll(' ', '').includes(searchQuery.trim().replaceAll(' ', ''));
      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;
      if (a[1][0].year === b[1][0].year) {
        return a[0].localeCompare(b[0]);
      } else {
        const aYear = a[1][0].year;
        const bYear = b[1][0].year;
        if (aYear === 'unknown' && bYear === 'unknown') return 0;
        if (aYear === 'unknown') return 1;
        if (bYear === 'unknown') return -1;
        return aYear > bYear ? -1 : 1;
      }
    });
  }, [searchResults, searchQuery]);

  // 处理收藏夹数据同步
  const updateFavoriteItems = async (allFavorites: Record<string, any>) => {
    const allPlayRecords = await getAllPlayRecords();
    const sorted = Object.entries(allFavorites)
      .sort(([, a], [, b]) => b.save_time - a.save_time)
      .map(([key, fav]) => {
        const plusIndex = key.indexOf('+');
        const source = key.slice(0, plusIndex);
        const id = key.slice(plusIndex + 1);
        const playRecord = allPlayRecords[key];
        const currentEpisode = playRecord?.index;

        return {
          id,
          source,
          title: fav.title,
          year: fav.year,
          poster: fav.cover,
          episodes: fav.total_episodes,
          source_name: fav.source_name,
          currentEpisode,
          search_title: fav?.search_title,
        } as FavoriteItem;
      });
    setFavoriteItems(sorted);
  };

  useEffect(() => {
    if (activeTab !== 'favorites') return;
    getAllFavorites().then(updateFavoriteItems);
    return subscribeToDataUpdates('favoritesUpdated', updateFavoriteItems);
  }, [activeTab]);

  const handleCloseAnnouncement = (announcement: string) => {
    setShowAnnouncement(false);
    localStorage.setItem('hasSeenAnnouncement', announcement);
  };

  return (
    <PageLayout>
      <div className='px-2 sm:px-10 py-4 sm:py-8 overflow-visible'>
        
        {/* 第一层：顶级直观大搜索框 */}
        <div className='mb-8 max-w-2xl mx-auto'>
          <form onSubmit={onFormSubmit}>
            <div className='relative'>
              <Search className='absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400' />
              <input
                id='searchInput'
                type='text'
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (!e.target.value.trim()) setShowResults(false);
                }}
                placeholder='在此直接搜电影、电视剧，海报100%不裂开...'
                className='w-full h-12 rounded-lg bg-gray-50/80 py-3 pl-10 pr-10 text-sm text-gray-700 border border-gray-200/50 shadow-sm dark:bg-gray-800 dark:text-gray-300'
              />
              {searchQuery && (
                <button
                  type='button'
                  onClick={() => {
                    setSearchQuery('');
                    setShowResults(false);
                  }}
                  className='absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600'
                >
                  <X className='w-5 h-5' />
                </button>
              )}
            </div>
          </form>
        </div>

        {/* 顶部 Tab 切换 */}
        <div className='mb-8 flex justify-center'>
          <CapsuleSwitch
            options={[
              { label: '首页', value: 'home' },
              { label: '收藏夹', value: 'favorites' },
            ]}
            active={activeTab}
            onChange={(value) => setActiveTab(value as 'home' | 'favorites')}
          />
        </div>

        <div className='max-w-[95%] mx-auto'>
          {activeTab === 'favorites' ? (
            // 收藏夹视图
            <section className='mb-8'>
              <div className='mb-4 flex items-center justify-between'>
                <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>我的收藏</h2>
                {favoriteItems.length > 0 && (
                  <button
                    className='text-sm text-gray-500 hover:text-red-500'
                    onClick={async () => {
                      await clearAllFavorites();
                      setFavoriteItems([]);
                    }}
                  >
                    清空
                  </button>
                )}
              </div>
              <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'>
                {favoriteItems.map((item) => (
                  <div key={item.id + item.source} className='w-full'>
                    <VideoCard
                      query={item.search_title}
                      {...item}
                      from='favorite'
type={item.episodes > 1 ? 'tv' : ''}/>))}{favoriteItems.length === 0 && (暂无收藏内容)}) : (// 纯净首页：继续观看 ➔ 下方并行渲染采集站搜索结果{/* 能完美读取本地缓存、带海报的“继续观看” */}{/* 核心整合流：将搜索卡片瀑布流塞到下方 */}{isLoading ? () : showResults ? () : searchHistory.length > 0 ? (// 展示搜索历史) : (💡 输入片名敲回车，20个纯净国内采集站将同步并发为你展现结果)})}{/* 提示公告 */}{announcement && showAnnouncement && (提示{announcement}<buttononClick={() => handleCloseAnnouncement(announcement)}className='w-full rounded-lg bg-green-600 px-4 py-3 text-white font-medium hover:bg-green-700 transition-colors'>我知道了)}{/* 返回顶部 */}<buttononClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}className={fixed bottom-6 right-6 z-[500] w-12 h-12 bg-green-500/90 text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-300 ${ showBackToTop ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none' }}>);}export default function Home() {return ();}
