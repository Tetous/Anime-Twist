import { SimpleLineIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CheckBox from '@react-native-community/checkbox';
import Slider from '@react-native-community/slider';
import { Video } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import { lockAsync, OrientationLock } from 'expo-screen-orientation';
import { setStatusBarHidden } from 'expo-status-bar';
import PropTypes from 'prop-types';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Text, TouchableOpacity, View,
} from 'react-native';
import { connect } from 'react-redux';

import styles from './styles';

import {
  markEpisodeAsComplete,
  markEpisodeAsCurrent,
  undoMarkEpisodeAsComplete,
} from '../../store/actions';

import { decryptSource } from '../../services/api';

import { baseURL, userAgent } from '../../constants';

import { millisToTime } from '../../utils';

const MIN_VIDEO_RESUME_POSITION = 90000; // 1 minute and a half
const PLAYER_HIDE_TIMEOUT = 5000; // 5 seconds
const SEEK_MILLIS = 10000; // 10 seconds

let timeout = null;

const VideoScreen = ({
  completeEpisodes,
  markEpisodeAsComplete,
  markEpisodeAsCurrent,
  navigation,
  route,
  settings,
  undoMarkEpisodeAsComplete,
}) => {
  const {
    anime, animeSources, firstEpisode, firstEpisodeIsComplete, firstEpisodeTime,
  } = route.params;

  const videoRef = useRef(null);

  const deleteTime = useRef(true);
  const lastEpisodes = useRef({});
  const videoCompletePosition = useRef(null);
  const videoIsPaused = useRef(false);
  const videoPausedOnSlide = useRef(false);
  const videoPlayerIsHidden = useRef(false);

  const [episodePlaying, setEpisodePlaying] = useState({});
  const [showError, setShowError] = useState(false);
  const [toggleCheckBox, setToggleCheckBox] = useState(false);
  const [videoDurationMillis, setVideoDurationMillis] = useState(0);
  const [videoIsLoading, setVideoIsLoading] = useState(true);
  const [videoPositionMillis, setVideoPositionMillis] = useState(0);
  const [videoPositionMillisForText, setVideoPositionMillisForText] = useState(0);

  const [controlsOpacityAnimation] = useState(new Animated.Value(1));
  const [iconOpacityAnimation] = useState(new Animated.Value(0));

  const isEpisodeComplete = (episode) => {
    const arrayOfEpisodes = completeEpisodes[episode.anime_id];

    if (arrayOfEpisodes) return arrayOfEpisodes.includes(episode.number);

    return false;
  };

  const deleteLastEpisodeTime = async () => {
    try {
      delete lastEpisodes.current[anime.id];

      await AsyncStorage.setItem('lastEpisodes', JSON.stringify(lastEpisodes.current));
    } catch (error) {
      // console.log(error);
    }
  };

  const getLastEpisodes = async () => {
    try {
      const result = await AsyncStorage.getItem('lastEpisodes');

      return result !== null ? JSON.parse(result) : {};
    } catch (error) {
      return {};
    }
  };

  const saveEpisodeTime = async (episode, millis) => {
    try {
      lastEpisodes.current[anime.id] = {
        episode: episode.number,
        millis,
      };

      await AsyncStorage.setItem('lastEpisodes', JSON.stringify(lastEpisodes.current));
    } catch (error) {
      // console.log(error);
    }
  };

  const playControlsOpacityAnimation = (toValue) => Animated.spring(controlsOpacityAnimation, {
    friction: 10,
    toValue,
    useNativeDriver: true,
  }).start();

  const handleHideTimeout = (onlyClear = false) => {
    if (timeout) clearTimeout(timeout);

    if (!onlyClear && !videoPlayerIsHidden.current) {
      timeout = setTimeout(() => {
        playControlsOpacityAnimation(0);

        videoPlayerIsHidden.current = true;
      }, PLAYER_HIDE_TIMEOUT);
    }
  };

  const loadVideo = (source, positionMillis = 0) => {
    videoRef.current.unloadAsync();

    handleHideTimeout();

    videoRef.current.loadAsync({
      headers: {
        referer: baseURL,
        'user-agent': userAgent,
      },
      uri: source,
    }, {
      positionMillis,
      progressUpdateIntervalMillis: 500,
      shouldPlay: true,
    });

    videoIsPaused.current = false;

    iconOpacityAnimation.setValue(0);
  };

  const setInitialData = async () => {
    const lastEpisodesResponse = await getLastEpisodes();

    if (lastEpisodesResponse) {
      lastEpisodes.current = lastEpisodesResponse;
    }

    setEpisodePlaying(firstEpisode);
    setToggleCheckBox(firstEpisodeIsComplete);

    if (videoRef.current) loadVideo(decryptSource(firstEpisode.source), firstEpisodeTime);
  };

  useEffect(() => {
    const { LANDSCAPE, PORTRAIT } = OrientationLock;

    setStatusBarHidden(true);

    lockAsync(LANDSCAPE);

    setInitialData();

    return () => {
      setStatusBarHidden(false);

      lockAsync(PORTRAIT);
    };
  }, []);

  const handleBackArrowPress = () => navigation.goBack();

  const handleCheckBoxValueChange = (newValue) => {
    if (newValue) markEpisodeAsComplete(episodePlaying);
    else undoMarkEpisodeAsComplete(episodePlaying);

    setToggleCheckBox(newValue);
  };

  const handleLoad = (status) => {
    videoCompletePosition.current = status.durationMillis * 0.9;

    setVideoDurationMillis(status.durationMillis);
  };

  const handleMainTouchablePress = () => {
    playControlsOpacityAnimation(videoPlayerIsHidden.current ? 1 : 0);

    videoPlayerIsHidden.current = !videoPlayerIsHidden.current;

    handleHideTimeout();
  };

  const handlePlaybackStatusUpdate = (status) => {
    if (status.positionMillis) {
      setVideoPositionMillis(status.positionMillis);
      setVideoPositionMillisForText(status.positionMillis);

      if (status.positionMillis > MIN_VIDEO_RESUME_POSITION
        && status.positionMillis < videoCompletePosition.current
      ) {
        saveEpisodeTime(episodePlaying, status.positionMillis);
      }
    }

    if (status.isLoaded) {
      if (!videoIsLoading) {
        if (status.isBuffering && !status.isPlaying && !videoIsPaused.current) {
          setVideoIsLoading(true);
        }
      } else if (videoIsLoading && status.isPlaying) setVideoIsLoading(false);
    }

    if (status.error) {
      setShowError(true);
      setVideoIsLoading(false);
    }

    if (deleteTime.current
      && videoCompletePosition.current
      && status.positionMillis > videoCompletePosition.current
    ) {
      deleteLastEpisodeTime();

      deleteTime.current = false;

      if (settings.autoMark && !isEpisodeComplete(episodePlaying)) {
        markEpisodeAsComplete(episodePlaying);

        setToggleCheckBox(true);
      }
    }

    if (status.didJustFinish) {
      videoIsPaused.current = true;

      iconOpacityAnimation.setValue(1);

      if (settings.autoplay && episodePlaying.number < animeSources.length) {
        const nextEpisode = animeSources.find((item) => item.number === episodePlaying.number + 1);

        markEpisodeAsCurrent(nextEpisode);

        deleteTime.current = true;

        setEpisodePlaying(nextEpisode);
        setToggleCheckBox(isEpisodeComplete(nextEpisode));

        loadVideo(decryptSource(nextEpisode.source));
      }
    }
  };

  const handlePlayPausePress = () => {
    if (videoIsPaused.current) videoRef.current.playAsync();
    else videoRef.current.pauseAsync();

    videoIsPaused.current = !videoIsPaused.current;

    iconOpacityAnimation.setValue(videoIsPaused.current ? 1 : 0);

    handleHideTimeout();
  };

  const handleRetryPress = () => {
    setShowError(false);
    setVideoIsLoading(true);

    loadVideo(episodePlaying.source, videoPositionMillis);
  };

  const handleSliderValueChange = (value) => setVideoPositionMillisForText(value);

  const handleSlidingComplete = (value) => {
    if (videoPausedOnSlide.current) {
      videoRef.current.playFromPositionAsync(value);

      videoIsPaused.current = false;
      videoPausedOnSlide.current = false;

      iconOpacityAnimation.setValue(0);
    } else videoRef.current.setPositionAsync(value);

    handleHideTimeout();
  };

  const handleSlidingStart = () => {
    if (!videoIsPaused.current) {
      videoRef.current.pauseAsync();

      videoIsPaused.current = true;
      videoPausedOnSlide.current = true;

      iconOpacityAnimation.setValue(1);
    }

    handleHideTimeout(true);
  };

  const handleSeeking = (value) => {
    let nextMillis = videoPositionMillis + value;

    if (nextMillis < 0) nextMillis = 0;
    else if (nextMillis > videoDurationMillis) nextMillis = videoDurationMillis;

    videoRef.current.setPositionAsync(nextMillis);

    handleHideTimeout();
  };

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={handleMainTouchablePress}
      style={styles.containerTouchable}
    >
      <Animated.View style={styles.container}>
        <Animated.View
          style={[styles.gradientView, {
            opacity: controlsOpacityAnimation,
          }]}
        >
          <LinearGradient
            colors={['rgba(0, 0, 0, 0.5)', 'rgba(0, 0, 0, 0.25)', 'rgba(0, 0, 0, 0.5)']}
            locations={[0.005, 0.5, 0.995]}
            style={styles.gradient}
          />
        </Animated.View>

        <Video
          onLoad={handleLoad}
          onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
          ref={videoRef}
          resizeMode={Video.RESIZE_MODE_CONTAIN}
          style={styles.video}
        />

        <Animated.View
          style={[styles.upperControls, {
            opacity: controlsOpacityAnimation,
            transform: [{
              translateY: controlsOpacityAnimation.interpolate({
                inputRange: [0, 0.005, 1],
                outputRange: [-500, -1, 0],
              }),
            }],
          }]}
        >
          <View style={styles.upperLeftView}>
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={handleBackArrowPress}
              style={styles.backButton}
            >
              <SimpleLineIcons color="white" name="arrow-left" size={20} />
            </TouchableOpacity>

            <Text style={styles.episodeText}>
              {`Episode ${episodePlaying.number}`}
            </Text>
          </View>

          <CheckBox
            onValueChange={handleCheckBoxValueChange}
            value={toggleCheckBox}
            style={styles.checkBox}
            tintColors={{
              true: '#e63232',
              false: 'rgba(255, 255, 255, 0.75)',
            }}
          />
        </Animated.View>

        <ActivityIndicator
          animating={videoIsLoading}
          color="#e63232"
          size={80}
          style={styles.loading}
        />

        {showError ? (
          <View style={styles.errorView}>
            <Text style={styles.errorText}>
              {'Could not load video.\nIf retrying doesn\'t work, restart the app.'}
            </Text>

            <TouchableOpacity
              activeOpacity={0.75}
              onPress={handleRetryPress}
              style={styles.errorButton}
            >
              <Text style={styles.errorText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Animated.View
            style={[styles.centerControls, {
              opacity: controlsOpacityAnimation,
              transform: [{
                translateY: controlsOpacityAnimation.interpolate({
                  inputRange: [0, 0.005, 1],
                  outputRange: [500, 1, 0],
                }),
              }],
            }]}
          >
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={() => handleSeeking(-SEEK_MILLIS)}
              style={styles.centerControlsButton}
            >
              <SimpleLineIcons color="white" name="control-rewind" size={24} />
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.75}
              onPress={handlePlayPausePress}
              style={styles.centerControlsButton}
            >
              <Animated.View
                style={[styles.centerControlsPlayPauseIcon, {
                  opacity: iconOpacityAnimation,
                }]}
              >
                <SimpleLineIcons color="white" name="control-play" size={32} />
              </Animated.View>

              <Animated.View
                style={[styles.centerControlsPlayPauseIcon, {
                  opacity: iconOpacityAnimation.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 0],
                  }),
                }]}
              >
                <SimpleLineIcons color="white" name="control-pause" size={32} />
              </Animated.View>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.75}
              onPress={() => handleSeeking(SEEK_MILLIS)}
              style={styles.centerControlsButton}
            >
              <SimpleLineIcons color="white" name="control-forward" size={24} />
            </TouchableOpacity>
          </Animated.View>
        )}

        <Animated.View
          style={[styles.lowerControls, {
            opacity: controlsOpacityAnimation,
            transform: [{
              translateY: controlsOpacityAnimation.interpolate({
                inputRange: [0, 0.005, 1],
                outputRange: [500, 1, 0],
              }),
            }],
          }]}
        >
          <Text style={styles.timeText}>{millisToTime(videoPositionMillisForText)}</Text>

          <Slider
            minimumTrackTintColor="#e63232"
            maximumValue={videoDurationMillis}
            minimumValue={0}
            onSlidingComplete={handleSlidingComplete}
            onSlidingStart={handleSlidingStart}
            onValueChange={handleSliderValueChange}
            style={styles.slider}
            thumbTintColor="#e63232"
            value={videoPositionMillis}
          />

          <Text style={styles.timeText}>{millisToTime(videoDurationMillis)}</Text>
        </Animated.View>
      </Animated.View>
    </TouchableOpacity>
  );
};

VideoScreen.propTypes = {
  completeEpisodes: PropTypes.shape().isRequired,
  markEpisodeAsComplete: PropTypes.func.isRequired,
  markEpisodeAsCurrent: PropTypes.func.isRequired,
  navigation: PropTypes.shape({
    goBack: PropTypes.func.isRequired,
  }).isRequired,
  route: PropTypes.shape().isRequired,
  settings: PropTypes.shape({
    autoMark: PropTypes.bool.isRequired,
    autoplay: PropTypes.bool.isRequired,
  }).isRequired,
  undoMarkEpisodeAsComplete: PropTypes.func.isRequired,
};

const mapDispatchToProps = {
  markEpisodeAsComplete,
  markEpisodeAsCurrent,
  undoMarkEpisodeAsComplete,
};

const mapStateToProps = (state) => ({
  completeEpisodes: state.animeReducer.animeObjectForEpisodes,
  settings: state.animeReducer.settings,
});

export default connect(mapStateToProps, mapDispatchToProps)(VideoScreen);
