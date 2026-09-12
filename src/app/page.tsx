/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

'use client';

import { ChevronUp, Search, X } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';

// 客户端状态与 API 导入
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
import { SearchResult } from '@/lib/types';
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

  // === 整合搜索页面的核心状态 ===
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showBackToTop, setShowBackToTop] = useState(false);

  // 获取默认聚合设置
  const getDefaultAggregate = () => {
    if (typeof window !== 'undefined') {
      const userSetting = localStorage.getItem('defaultAggregateSearch');
      if (userSetting !== null) {
        return JSON.parse(userSetting);
      }
    }
    return true;
  };

  const [viewMode, setViewMode] = useState<'agg' | 'all'>(() => {
    return getDefaultAggregate() ? 'agg' : 'all';
  });

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

  // 收藏夹数据类型
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

  // 初始加载：获取搜索历史并启动返回顶部检测
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
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      unsubscribeHistory();
      document.body.removeEventListener('scroll', handleScroll);
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // 核心并发搜索算法逻辑
  const fetchSearchResults = async (query: string) => {
    if (!query.trim()) return;
    try {
      setIsLoading(true);
      setShowResults(true);
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(query.trim())}`
      );
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
          const aExactMatch = a.title === query.trim();
          const bExactMatch = b.title === query.trim();
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
      console.error('搜索失败:', error);
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim().replace(/\s+/g, ' ');
    if (!trimmed) return;
    fetchSearchResults(trimmed);
    addSearchHistory(trimmed);
  };

  // 整合后的高效聚合逻辑
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

  // 处理收藏数据更新
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
        
        {/* 1. 顶部极简搜索框：一打字直接在首页触发并行的 20 个源搜索 */}
        <div className='mb-6 max-w-2xl mx-auto'>
          <form onSubmit={handleSearchSubmit}>
            <div className='relative'>
              <Search className='absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400' />
              <input
                id='searchInput'
                type='text'
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (!e.target.value.trim()) {
                    setShowResults(false);
                  }
                }}
                placeholder='在此直接搜索全网电影、电视剧...'
                className='w-full h-12 rounded-lg bg-gray-50/80 py-3 pl-10 pr-10 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-400 focus:bg-white border border-gray-200/50 shadow-sm dark:bg-gray-800 dark:text-gray-300 dark:placeholder-gray-500'
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

        {/* 2. 视图 Tab 切换（首页 / 收藏夹） */}
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
await clearAllFavorites();setFavoriteItems([]);}}>清空)}{favoriteItems.map((item) => (<div key={item.id + item.source} className='w-full'><VideoCardquery={item.search_title}{...item}from='favorite'type={item.episodes > 1 ? 'tv' : ''}/>))}{favoriteItems.length === 0 && (暂无收藏内容)}) : (// 完美首页视图：继续观看 ➔ 搜索结果（无痕秒加载，彻底清除裂开的豆瓣热门）{/* 第一流：继续观看（无防盗链大坑，正常显示海报） */}{/* 第二流：核心拦截演变流。如果用户搜了词，立即在继续观看下方生出带高清海报的采集站数据 */}{isLoading ? () : showResults ? () : searchHistory.length > 0 ? (// 如果没有处于搜索状态，下方优雅地展示搜索历史，方便直接点击追剧) : (// 全空状态下的温馨无感文案提示💡 输入你想看的片名，国内20个顶级采集站将无痕为你拉满检索)})}{/* 公告弹窗 */}{announcement && showAnnouncement && (提示{announcement}<buttononClick={() => handleCloseAnnouncement(announcement)}className='w-full rounded-lg bg-green-600 py-2.5 text-white font-medium hover:bg-green-700 transition-colors'>我知道了)}{/* 返回顶部悬浮按钮 */}<buttononClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}className={fixed bottom-6 right-6 z-[500] w-10 h-10 bg-green-500/90 text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-300 ${ showBackToTop ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none' }}aria-label='返回顶部'>);}export default function Home() {return ();}
