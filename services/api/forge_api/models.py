from pydantic import BaseModel, Field, field_validator
from typing import Optional, List
from enum import Enum
from datetime import datetime


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class RemoveBgMode(str, Enum):
    STANDARD = "standard"
    CONSERVATIVE = "conservative"
    WHITE = "white"


class WatermarkBox(BaseModel):
    x: float = Field(..., ge=0, le=1)
    y: float = Field(..., ge=0, le=1)
    w: float = Field(..., ge=0, le=1)
    h: float = Field(..., ge=0, le=1)


class Layout(BaseModel):
    cols: int = Field(default=4, ge=1, le=32)
    padding: int = Field(default=2, ge=0, le=20)


class CreateJobRequest(BaseModel):
    video_id: str = Field(..., min_length=1, max_length=64)
    timestamps_ms: List[float] = Field(..., min_length=1)
    remove_bg: bool = True
    remove_bg_mode: RemoveBgMode = RemoveBgMode.STANDARD
    watermark_box: Optional[WatermarkBox] = None
    layout: Layout = Layout()

    @field_validator("timestamps_ms")
    @classmethod
    def validate_timestamps(cls, v: List[float]) -> List[float]:
        if any(t < 0 for t in v):
            raise ValueError("时间戳不能为负数")
        return v


class VideoMeta(BaseModel):
    id: str
    filename: str
    duration_ms: float
    fps: float
    width: int
    height: int
    created_at: datetime


class VideoUploadResponse(BaseModel):
    video_id: str
    duration_ms: float
    fps: float
    width: int
    height: int
    url: str


class ExtractFramesRequest(BaseModel):
    timestamps_ms: List[float] = Field(..., min_length=1)

    @field_validator("timestamps_ms")
    @classmethod
    def validate_timestamps(cls, v: List[float]) -> List[float]:
        if any(t < 0 for t in v):
            raise ValueError("时间戳不能为负数")
        return v


class ExtractedFramePreview(BaseModel):
    ts_ms: int
    url: str


class ExtractFramesResponse(BaseModel):
    frames: List[ExtractedFramePreview]


class ImageMeta(BaseModel):
    id: str
    filename: str
    width: int
    height: int
    created_at: datetime


class ImageUploadResponse(BaseModel):
    image_id: str
    width: int
    height: int
    url: str


class SegmentBox(BaseModel):
    x: int = Field(..., ge=0)
    y: int = Field(..., ge=0)
    w: int = Field(..., gt=0)
    h: int = Field(..., gt=0)


class DetectedSegment(BaseModel):
    index: int
    box: SegmentBox


class DetectSegmentsResponse(BaseModel):
    segments: List[DetectedSegment]


class CreateImageJobRequest(BaseModel):
    image_id: str = Field(..., min_length=1, max_length=64)
    boxes: List[SegmentBox] = Field(..., min_length=1)
    remove_bg: bool = True
    layout: Layout = Layout()


class FrameSource(BaseModel):
    video_id: str = Field(..., min_length=1, max_length=64)
    ts_ms: float = Field(..., ge=0)
    x_offset: int = 0
    y_offset: int = 0


class CreateFrameAssemblyJobRequest(BaseModel):
    frames: List[FrameSource] = Field(..., min_length=1)
    remove_bg: bool = True
    remove_bg_mode: RemoveBgMode = RemoveBgMode.STANDARD
    layout: Layout = Layout()


class FrameOffset(BaseModel):
    x: int = 0
    y: int = 0


class RepackJobFramesRequest(BaseModel):
    frame_names: List[str] = Field(..., min_length=1)
    frame_offsets: dict[str, FrameOffset] = Field(default_factory=dict)


class RepackImageJobItemsRequest(BaseModel):
    item_names: List[str] = Field(..., min_length=1)


class JobResponse(BaseModel):
    job_id: str
    status: JobStatus


class JobStatusResponse(BaseModel):
    id: str
    video_id: str
    status: JobStatus
    progress: float
    stage: str
    params: CreateJobRequest
    error: Optional[str] = None
    created_at: datetime
    finished_at: Optional[datetime] = None
    result: Optional[dict] = None


class ImageJobStatusResponse(BaseModel):
    id: str
    image_id: str
    status: JobStatus
    progress: float
    stage: str
    params: CreateImageJobRequest
    error: Optional[str] = None
    created_at: datetime
    finished_at: Optional[datetime] = None
    result: Optional[dict] = None


class JobProgress(BaseModel):
    stage: str
    progress: float
    message: Optional[str] = None
    status: Optional[JobStatus] = None
    error: Optional[str] = None
